# BgUtils POT Provider

> [!CAUTION]
> Providing a PO token does not guarantee bypassing 403 errors or bot checks, but it _may_ help your traffic seem more legitimate.

[![Docker Image Version (tag)](https://img.shields.io/docker/v/brainicism/bgutil-ytdlp-pot-provider/latest?style=for-the-badge&label=docker)](https://hub.docker.com/r/brainicism/bgutil-ytdlp-pot-provider)
[![GitHub Release](https://img.shields.io/github/v/release/Brainicism/bgutil-ytdlp-pot-provider?style=for-the-badge)](https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases)
[![PyPI - Version](https://img.shields.io/pypi/v/bgutil-ytdlp-pot-provider?style=for-the-badge)](https://pypi.org/project/bgutil-ytdlp-pot-provider/)
[![CI Status](https://img.shields.io/github/actions/workflow/status/Brainicism/bgutil-ytdlp-pot-provider/test.yml?branch=master&label=Tests&style=for-the-badge)](https://github.com/Brainicism/bgutil-ytdlp-pot-provider/actions/workflows/test.yml)

[Frequently Asked Questions](https://github.com/Brainicism/bgutil-ytdlp-pot-provider?tab=readme-ov-file#faq)

A proof-of-origin token (POT) provider yt-dlp. We use [LuanRT's Botguard interfacing library](https://github.com/LuanRT/BgUtils) to generate the token.
This is used to bypass the 'Sign in to confirm you're not a bot' message when invoking yt-dlp from an IP address flagged by YouTube. See _[PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)_ for more details.

The provider comes in two parts:

1. **Provider**: Two options -
   - (a) An HTTP server that generates the POT, and has interfaces for the plugin to retrieve data from (easy setup + docker image provided)
   - (b) A POT generation script, and has command line options for the plugin to invoke (needs to transpile the script)
2. **Provider plugin**: uses POT plugin framework to retrieve data from the provider, allowing yt-dlp to simulate having passed the 'bot check'.

## Installation

### Base Requirements

1. Requires yt-dlp `2025.05.22` or above.

2. If using Docker image for option (a) for the provider, the Docker runtime is required.  
   Otherwise, Node.js (>= 18) is required. You will also need git to clone the repository.

### 1. Set up the provider

There are two options for the provider, an always running POT generation HTTP server, and a POT generation script invoked when needed. The HTTP server option is simpler, faster, and comes with a prebuilt Docker image. **You only need to choose one option.**

#### (a) HTTP Server Option

The provider is a Node.js HTTP server. You have two options for running it: as a prebuilt docker image, or manually as a node application.

**Docker:**

```shell
docker run --name bgutil-provider -d -p 4416:4416 --init brainicism/bgutil-ytdlp-pot-provider
```

> [!IMPORTANT]
> Note that the docker container's network is isolated from your local network by default. If you are using a local proxy server, it will not be accessible from within the container unless you pass `--net=host` as well.

**Native:**

```shell
# Replace 1.2.2 with the latest version or the one that matches the plugin
git clone --single-branch --branch 1.2.2 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git
cd bgutil-ytdlp-pot-provider/server/
npm install
npx tsc
node build/main.js
```

**Server Command Line Options**

- `-p, --port <PORT>`: The port on which the server listens.

#### (b) Generation Script Option

> [!IMPORTANT]
> This method is not recommended for high concurrency usage. Every yt-dlp call incurs the overhead of spawning a new node process to run the script. This method also handles cache concurrency poorly.

1. Transpile the generation script to Javascript:

```shell
# If you want to use this method without specifying `script_path` extractor argument
# on each yt-dlp invocation, clone/extract the source code into your home directory.
# Replace `~` with `%USERPROFILE%` if using Windows
cd ~
# Replace 1.2.2 with the latest version or the one that matches the plugin
git clone --single-branch --branch 1.2.2 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git
cd bgutil-ytdlp-pot-provider/server/
npm install
npx tsc
```

2. Make sure `node` is available in your `PATH`.

### 2. Install the plugin

#### PyPI:

If yt-dlp is installed through `pip` or `pipx`, you can install the plugin with the following:

```shell
python3 -m pip install -U bgutil-ytdlp-pot-provider
```

#### Manual:

1. Download the latest release zip from [releases](https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases).
2. Install it by placing the zip into one of the [plugin folders](https://github.com/yt-dlp/yt-dlp#installing-plugins).

## Usage

If using option (a) HTTP Server for the provider, and the default IP/port number, you can use yt-dlp like normal 🙂.

If you want to change the port number used by the provider server, use the `--port` option.

```shell
node build/main.js --port 8080
```

If changing the port or IP used for the provider server, pass it to yt-dlp via `base_url`

```shell
--extractor-args "youtubepot-bgutilhttp:base_url=http://127.0.0.1:8080"
```

If the tokens are no longer working, passing `disable_innertube=1` to yt-dlp restores the legacy behaviour and _might_ help

```shell
--extractor-args "youtubepot-bgutilhttp:base_url=http://127.0.0.1:8080;disable_innertube=1"
```

Note that when you pass multiple extractor arguments to one provider or extractor, they are to be separated by semicolons(`;`) as shown above. Multiple `--extractor-args` will **NOT** work for the same provier/extractor.

---

If using option (b) script for the provider, with the default script location in your home directory (i.e: `~/bgutil-ytdlp-pot-provider` or `%USERPROFILE%\bgutil-ytdlp-pot-provider`), you can also use yt-dlp like normal.

If you installed the script in a different location, pass it as the extractor argument `script_path` to `youtube-bgutilscript` for each yt-dlp call.

```shell
--extractor-args "youtubepot-bgutilscript:script_path=/path/to/bgutil-ytdlp-pot-provider/server/build/generate_once.js"
```

---

We use a cache internally for all generated tokens when option (b) script is used. You can change the TTL (time to live) for the token cache with the environment variable `TOKEN_TTL` (in hours, defaults to 6). It's currently impossible to use different TTLs for different token contexts (can be `gvs`, `player`, or `subs`, see [Technical Details](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide#technical-details) from the PO Token Guide).  
That is, when using the script method, you can pass a `TOKEN_TTL` to yt-dlp to use a custom TTL for PO Tokens.

---

If both methods are available for use, the option (a) HTTP server method will be prioritized.

### Verification

To check if the plugin was installed correctly, you should see the `bgutil` providers in yt-dlp's verbose output: `yt-dlp -v YOUTUBE_URL`.

```
[debug] [youtube] [pot] PO Token Providers: bgutil:http-1.2.2 (external), bgutil:script-1.2.2 (external)
```

### FAQ

#### I'm getting errors during `npm install` on Termux

For provider versions >=1.2.0, you may have issues while installing the `canvas` dependency on Termux. The Termux environment is missing a `android_ndk_path` and two packages by default. Run the following commands to setup the dependencies correctly.

```shell
mkdir ~/.gyp && echo "{'variables':{'android_ndk_path':''}}" > ~/.gyp/include.gypi
pkg install libvips xorgproto
```
