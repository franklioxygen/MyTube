#define _GNU_SOURCE
#include <arpa/inet.h>
#include <dlfcn.h>
#include <errno.h>
#include <netdb.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

/* Enforce at connect/send, after resolution. Do not change DNS or proxy routing.
 * This protects the supported dynamically linked download tools, not hostile
 * administrator-supplied native code (which could issue syscalls directly).
 */
static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static char policy[65536];
static struct sockaddr_storage proxies[512];
static size_t proxy_count;
static struct in6_addr resolvers[16];
static size_t resolver_count;
static pthread_once_t symbols_once = PTHREAD_ONCE_INIT;
static int (*real_getaddrinfo)(const char *, const char *, const struct addrinfo *, struct addrinfo **);
static int (*real_connect)(int, const struct sockaddr *, socklen_t);
static ssize_t (*real_sendto)(int, const void *, size_t, int, const struct sockaddr *, socklen_t);
static ssize_t (*real_sendmsg)(int, const struct msghdr *, int);
static int (*real_sendmmsg)(int, struct mmsghdr *, unsigned, int);

static void diagnostic(const char *message, size_t size) {
    /* Best-effort logging: a closed stderr must not change the deny decision. */
    ssize_t written = write(STDERR_FILENO, message, size);
    (void)written;
}

static void load_symbols(void) {
    real_getaddrinfo = dlsym(RTLD_NEXT, "getaddrinfo");
    real_connect = dlsym(RTLD_NEXT, "connect");
    real_sendto = dlsym(RTLD_NEXT, "sendto");
    real_sendmsg = dlsym(RTLD_NEXT, "sendmsg");
    real_sendmmsg = dlsym(RTLD_NEXT, "sendmmsg");
    if (!real_getaddrinfo || !real_connect || !real_sendto || !real_sendmsg || !real_sendmmsg) {
        static const char message[] = "MyTube SSRF protection: required network symbols unavailable\n";
        diagnostic(message, sizeof(message) - 1); _exit(126);
    }
}

static int address(const struct sockaddr *sa, socklen_t len, struct in6_addr *ip, unsigned *port) {
    memset(ip, 0, sizeof(*ip));
    if (sa->sa_family == AF_INET && len >= sizeof(struct sockaddr_in)) {
        const struct sockaddr_in *v4 = (const void *)sa;
        ip->s6_addr[10] = ip->s6_addr[11] = 255;
        // nosemgrep: c_buffer_rule-memcpy-CopyMemory
        memcpy(ip->s6_addr + 12, &v4->sin_addr, 4); /* Flawfinder: ignore - 4-byte IPv4 into the last 4 bytes of a 16-byte address. */
        *port = ntohs(v4->sin_port);
        return 1;
    }
    if (sa->sa_family == AF_INET6 && len >= sizeof(struct sockaddr_in6)) {
        const struct sockaddr_in6 *v6 = (const void *)sa;
        *ip = v6->sin6_addr; *port = ntohs(v6->sin6_port);
        return 1;
    }
    return 0;
}

static int public_ip(const struct in6_addr *ip) {
    const unsigned char *p = ip->s6_addr;
    if (IN6_IS_ADDR_V4MAPPED(ip)) {
        p += 12;
        return !(p[0] == 0 || p[0] == 10 || p[0] == 127 || p[0] >= 224 ||
            (p[0] == 100 && p[1] >= 64 && p[1] <= 127) ||
            (p[0] == 169 && p[1] == 254) || (p[0] == 172 && p[1] >= 16 && p[1] <= 31) ||
            (p[0] == 192 && (p[1] == 168 || (p[1] == 0 && (p[2] == 0 || p[2] == 2)))) ||
            (p[0] == 198 && (p[1] == 18 || p[1] == 19 || (p[1] == 51 && p[2] == 100))) ||
            (p[0] == 203 && p[1] == 0 && p[2] == 113));
    }
    return (p[0] & 0xe0) == 0x20 &&
        !(p[0] == 0x20 && p[1] == 0x01 &&
            ((p[2] == 0 && p[3] == 0) || (p[2] == 0x0d && p[3] == 0xb8))) &&
        !(p[0] == 0x20 && p[1] == 0x02);
}

/* Called by the native CLI bootstrap after it has parsed administrator config.
 * The same policy is inherited by ffmpeg and provider subprocesses.
 */
int mytube_network_policy(const char *value) {
    if (!value || strnlen(value, sizeof(policy)) >= sizeof(policy)) return 0;
    pthread_mutex_lock(&lock);
    snprintf(policy, sizeof(policy), "%s", value); proxy_count = 0;
    pthread_mutex_unlock(&lock);
    return 1;
}

static int trusted_host(const char *host, unsigned port) {
    const char *line = policy;
    size_t length = strnlen(host, 1024);
    if (length == 1024) return 0;
    while (length && host[length - 1] == '.') length--;
    unsigned configured_port; char configured_host[1024];
    while (*line) {
        if (sscanf(line, "%u %1023s", &configured_port, configured_host) == 2 && /* Flawfinder: ignore - 1023 chars plus NUL fit configured_host[1024]. */
            port == configured_port && strnlen(configured_host, sizeof(configured_host)) == length && !strncasecmp(host, configured_host, length)) return 1;
        line = strchr(line, '\n'); if (!line) break; line++;
    }
    return 0;
}

int getaddrinfo(const char *host, const char *service, const struct addrinfo *hints, struct addrinfo **result) {
    pthread_once(&symbols_once, load_symbols);
    int status = real_getaddrinfo(host, service, hints, result);
    if (status || !host) return status;
    pthread_mutex_lock(&lock);
    for (struct addrinfo *item = *result; item; item = item->ai_next) {
        struct in6_addr ip; unsigned port;
        if (!address(item->ai_addr, item->ai_addrlen, &ip, &port) || !trusted_host(host, port)) continue;
        int duplicate = 0;
        for (size_t i = 0; i < proxy_count; i++) {
            struct in6_addr other; unsigned other_port;
            if (address((void *)&proxies[i], sizeof(proxies[i]), &other, &other_port) &&
                port == other_port && !memcmp(&ip, &other, sizeof(ip))) duplicate = 1;
        }
        if (!duplicate && proxy_count < sizeof(proxies) / sizeof(proxies[0]) && item->ai_addrlen <= sizeof(proxies[0])) {
            memset(&proxies[proxy_count], 0, sizeof(proxies[0]));
            // nosemgrep: c_buffer_rule-memcpy-CopyMemory
            memcpy(&proxies[proxy_count++], item->ai_addr, item->ai_addrlen); /* Flawfinder: ignore - count and destination size checked above. */
        }
    }
    pthread_mutex_unlock(&lock);
    return status;
}

static int allowed(const struct sockaddr *sa, socklen_t len) {
    if (!sa || !len) return 1;
    if (len < sizeof(sa->sa_family)) return 0;
    if (sa->sa_family == AF_UNSPEC) return 1;
    struct in6_addr ip; unsigned port;
    if (!address(sa, len, &ip, &port)) return 0;
    if (public_ip(&ip)) return 1;
    int ok = 0;
    pthread_mutex_lock(&lock);
    for (size_t i = 0; !ok && i < proxy_count; i++) {
        struct in6_addr other; unsigned other_port;
        if (address((void *)&proxies[i], sizeof(proxies[i]), &other, &other_port) &&
            port == other_port && !memcmp(&ip, &other, sizeof(ip))) ok = 1;
    }
    /* Numeric proxy URLs may never call getaddrinfo (notably libcurl). */
    const char *line = policy;
    while (!ok && *line) {
        unsigned configured_port; char host[1024]; struct in6_addr other;
        if (sscanf(line, "%u %1023s", &configured_port, host) == 2 && port == configured_port) { /* Flawfinder: ignore - 1023 chars plus NUL fit host[1024]. */
            struct in_addr v4;
            if (inet_pton(AF_INET, host, &v4) == 1) {
                memset(&other, 0, sizeof(other)); other.s6_addr[10] = other.s6_addr[11] = 255;
                // nosemgrep: c_buffer_rule-memcpy-CopyMemory
                memcpy(other.s6_addr + 12, &v4, 4); /* Flawfinder: ignore - 4-byte IPv4 into the last 4 bytes of a 16-byte address. */
                ok = !memcmp(&ip, &other, sizeof(ip));
            } else if (inet_pton(AF_INET6, host, &other) == 1) ok = !memcmp(&ip, &other, sizeof(ip));
        }
        line = strchr(line, '\n'); if (!line) break; line++;
    }
    /* DNS resolution is an explicit trusted service, not arbitrary port 53. */
    for (size_t i = 0; !ok && port == 53 && i < resolver_count; i++)
        ok = !memcmp(&ip, &resolvers[i], sizeof(ip));
    pthread_mutex_unlock(&lock);
    if (!ok) {
        static const char message[] = "MyTube SSRF protection: blocked private/internal connection\n";
        diagnostic(message, sizeof(message) - 1);
        errno = EACCES;
    }
    return ok;
}

__attribute__((constructor)) static void initialize(void) {
    pthread_once(&symbols_once, load_symbols);
    const char *inherited = getenv("MYTUBE_NETWORK_PROXIES");
    if (inherited) mytube_network_policy(inherited);
    FILE *file = fopen("/etc/resolv.conf", "r");
    if (!file) return;
    char line[2048], host[1024];
    while (resolver_count < sizeof(resolvers) / sizeof(resolvers[0]) && fgets(line, sizeof(line), file)) {
        if (sscanf(line, "nameserver %1023s", host) != 1) continue; /* Flawfinder: ignore - 1023 chars plus NUL fit host[1024]. */
        struct in6_addr ip; struct in_addr v4;
        if (inet_pton(AF_INET, host, &v4) == 1) {
            memset(&ip, 0, sizeof(ip)); ip.s6_addr[10] = ip.s6_addr[11] = 255;
            // nosemgrep: c_buffer_rule-memcpy-CopyMemory
            memcpy(ip.s6_addr + 12, &v4, 4); /* Flawfinder: ignore - 4-byte IPv4 into the last 4 bytes of a 16-byte address. */
        } else if (inet_pton(AF_INET6, host, &ip) != 1) continue;
        resolvers[resolver_count++] = ip;
    }
    fclose(file);
}

int connect(int fd, const struct sockaddr *sa, socklen_t len) {
    pthread_once(&symbols_once, load_symbols);
    struct sockaddr_storage copy;
    if (!sa || len > sizeof(copy)) { errno = EACCES; return -1; }
    // nosemgrep: c_buffer_rule-memcpy-CopyMemory
    memcpy(&copy, sa, len); /* Flawfinder: ignore - len <= sizeof(copy) checked above. */
    if (!allowed((void *)&copy, len)) { errno = EACCES; return -1; }
    return real_connect(fd, (void *)&copy, len);
}

ssize_t sendto(int fd, const void *data, size_t size, int flags, const struct sockaddr *sa, socklen_t len) {
    pthread_once(&symbols_once, load_symbols);
    struct sockaddr_storage copy;
    if (sa) {
        if (len > sizeof(copy)) { errno = EACCES; return -1; }
        // nosemgrep: c_buffer_rule-memcpy-CopyMemory
        memcpy(&copy, sa, len); sa = (void *)&copy; /* Flawfinder: ignore - len <= sizeof(copy) checked above. */
    }
    if (!allowed(sa, len)) { errno = EACCES; return -1; }
    return real_sendto(fd, data, size, flags, sa, len);
}

ssize_t sendmsg(int fd, const struct msghdr *message, int flags) {
    pthread_once(&symbols_once, load_symbols);
    if (!message) { errno = EFAULT; return -1; }
    struct msghdr copy = *message;
    struct sockaddr_storage destination;
    if (message->msg_name) {
        if (message->msg_namelen > sizeof(destination)) { errno = EACCES; return -1; }
        // nosemgrep: c_buffer_rule-memcpy-CopyMemory
        memcpy(&destination, message->msg_name, message->msg_namelen); /* Flawfinder: ignore - msg_namelen <= sizeof(destination) checked above. */
        copy.msg_name = &destination;
    }
    if (!allowed(copy.msg_name, copy.msg_namelen)) { errno = EACCES; return -1; }
    return real_sendmsg(fd, &copy, flags);
}

int sendmmsg(int fd, struct mmsghdr *messages, unsigned count, int flags) {
    pthread_once(&symbols_once, load_symbols);
    if (!count) return real_sendmmsg(fd, messages, count, flags);
    if (!messages || count > 1024) { errno = EINVAL; return -1; }
    struct mmsghdr *copy = calloc(count, sizeof(*copy));
    struct sockaddr_storage *destinations = calloc(count, sizeof(*destinations));
    if (!copy || !destinations) { free(copy); free(destinations); errno = ENOMEM; return -1; }
    // nosemgrep: c_buffer_rule-memcpy-CopyMemory
    memcpy(copy, messages, count * sizeof(*copy)); /* Flawfinder: ignore - calloc allocated count elements; count <= 1024. */
    for (unsigned i = 0; i < count; i++) {
        struct msghdr *message = &copy[i].msg_hdr;
        if (message->msg_name) {
            if (message->msg_namelen > sizeof(destinations[i])) goto blocked;
            // nosemgrep: c_buffer_rule-memcpy-CopyMemory
            memcpy(&destinations[i], message->msg_name, message->msg_namelen); /* Flawfinder: ignore - length checked above; i < allocated count. */
            message->msg_name = &destinations[i];
        }
        if (!allowed(message->msg_name, message->msg_namelen)) goto blocked;
    }
    int result = real_sendmmsg(fd, copy, count, flags), saved = errno;
    for (int i = 0; i < result; i++) messages[i].msg_len = copy[i].msg_len;
    free(copy); free(destinations); errno = saved;
    return result;
blocked:
    free(copy); free(destinations); errno = EACCES;
    return -1;
}
