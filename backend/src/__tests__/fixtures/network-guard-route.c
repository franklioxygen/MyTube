/* Test only: map a checked public IP to a local fixture, after the guard. */
#define _GNU_SOURCE
#include <arpa/inet.h>
#include <dlfcn.h>
#include <errno.h>
#include <netdb.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
int getaddrinfo(const char *host, const char *service, const struct addrinfo *hints, struct addrinfo **result) {
    int (*next)(const char *, const char *, const struct addrinfo *, struct addrinfo **) = dlsym(RTLD_NEXT, "getaddrinfo");
    const char *filename = getenv("HOSTALIASES");
    FILE *file = filename ? fopen(filename, "r") : NULL;
    if (file) {
        char alias[256], value[256];
        while (fscanf(file, "%255s %255s", alias, value) == 2) {
            size_t length = host ? strlen(host) : 0;
            while (length && host[length - 1] == '.') length--;
            if (host && strlen(alias) == length && !strncasecmp(host, alias, length)) { fclose(file); return next(value, service, hints, result); }
        }
        fclose(file);
    }
    if (host && strstr(host, ".invalid")) return EAI_NONAME;
    return next(host, service, hints, result);
}
int connect(int fd, const struct sockaddr *sa, socklen_t len) {
    int (*next)(int, const struct sockaddr *, socklen_t) = dlsym(RTLD_NEXT, "connect");
    if (sa->sa_family == AF_INET) {
        struct sockaddr_in copy = *(const struct sockaddr_in *)sa;
        if (ntohl(copy.sin_addr.s_addr) == 0x5db8d822) {
            const char *port = getenv("MYTUBE_TEST_PUBLIC_PORT");
            if (!port || ntohs(copy.sin_port) != atoi(port)) { errno = ECONNREFUSED; return -1; }
            inet_pton(AF_INET, "127.0.0.1", &copy.sin_addr);
            return next(fd, (void *)&copy, sizeof(copy));
        }
    }
    if (sa->sa_family == AF_INET6) {
        struct sockaddr_in6 copy = *(const struct sockaddr_in6 *)sa;
        struct in6_addr expected; inet_pton(AF_INET6, "2606:4700:4700::1111", &expected);
        if (!memcmp(&copy.sin6_addr, &expected, sizeof(expected))) {
            const char *port = getenv("MYTUBE_TEST_PUBLIC_PORT");
            if (!port || ntohs(copy.sin6_port) != atoi(port)) { errno = ECONNREFUSED; return -1; }
            copy.sin6_addr = in6addr_loopback;
            return next(fd, (void *)&copy, sizeof(copy));
        }
    }
    return next(fd, sa, len);
}
