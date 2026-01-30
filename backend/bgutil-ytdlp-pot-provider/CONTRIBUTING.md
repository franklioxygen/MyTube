### Installation

This script will automatically copy the current working directory's plugin to one of the default yt-dlp plugin directory at `~/yt-dlp-plugins`. It will also install dependencies for the server/script and transpile as needed. Use it as a reference for manual installation.

```shell
bash install_plugin_dev.sh
```

### Coding conventions

Since the provider consists of two parts(the **Provider**(coded in typescript) and the **Provider plugin**(coded in python)), we have different code formatting standards for them.

Please format your code by running this script below before you push a commit:

```shell
# Make sure you have ruff, autopep8, eslint and prettier installed already
ruff check --fix plugin/
autopep8 --in-place plugin/

cd server
npx eslint --fix --max-warnings=0 src/
npx prettier --check --write "src/**/*.{js,ts}"
cd ..
```

If you don't want the code formatter to fix your code automatically, you may check if there's any problem with your code with this script:

```shell
# Make sure you have ruff, autopep8, eslint and prettier installed already
ruff check plugin/
autopep8 plugin/

cd server
npx eslint --max-warnings=0 src/
npx prettier --check "src/**/*.{js,ts}"
cd ..
```

#### **Provider**(typescript):

Please make sure your code passes eslint and prettier checks by running the script above.

#### **Provider plugin**(python):

As a yt-dlp plugin, we follow the [yt-dlp coding conventions](https://github.com/yt-dlp/yt-dlp/blob/master/CONTRIBUTING.md#yt-dlp-coding-conventions). You can use ruff and autopep8 to format your code, as shown in the script above.
