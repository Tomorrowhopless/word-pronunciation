# Piper Wasm

The files in `/build` were generated using the steps proposed by [wide-video / piper-wasm](https://github.com/wide-video/piper-wasm).

**As of JUN 2024:**
```sh
# Docker (optional)
docker run -it -v $(pwd):/wasm -w /wasm debian:11.3
apt-get update
apt-get install --yes --no-install-recommends build-essential cmake ca-certificates curl pkg-config git python3 autogen automake autoconf libtool

# Emscripten
git clone --depth 1 https://github.com/emscripten-core/emsdk.git /wasm/modules/emsdk
cd /wasm/modules/emsdk
./emsdk install 3.1.47
./emsdk activate 3.1.47
source ./emsdk_env.sh
TOOLCHAIN_FILE=$EMSDK/upstream/emscripten/cmake/Modules/Platform/Emscripten.cmake
sed -i -E 's/int\s+(iswalnum|iswalpha|iswblank|iswcntrl|iswgraph|iswlower|iswprint|iswpunct|iswspace|iswupper|iswxdigit)\(wint_t\)/\/\/\0/g' ./upstream/emscripten/cache/sysroot/include/wchar.h

# espeak-ng
git clone --depth 1 https://github.com/rhasspy/espeak-ng.git /wasm/modules/espeak-ng
cd /wasm/modules/espeak-ng
./autogen.sh
./configure
make

# piper-phonemize
git clone --depth 1 https://github.com/wide-video/piper-phonemize.git /wasm/modules/piper-phonemize
cd /wasm/modules/piper-phonemize
emmake cmake -Bbuild -DCMAKE_INSTALL_PREFIX=install -DCMAKE_TOOLCHAIN_FILE=$TOOLCHAIN_FILE -DBUILD_TESTING=OFF -G "Unix Makefiles" -DCMAKE_CXX_FLAGS="-O3 -s INVOKE_RUN=0 -s MODULARIZE=1 -s EXPORT_NAME='createPiperPhonemize' -s EXPORTED_FUNCTIONS='[_main]' -s EXPORTED_RUNTIME_METHODS='[callMain, FS]' --preload-file /wasm/modules/espeak-ng/espeak-ng-data@/espeak-ng-data"
emmake cmake --build build --config Release # fails on "Compile intonations / Permission denied", continue with next steps
sed -i 's+$(MAKE) $(MAKESILENT) -f CMakeFiles/data.dir/build.make CMakeFiles/data.dir/build+#\0+g' /wasm/modules/piper-phonemize/build/e/src/espeak_ng_external-build/CMakeFiles/Makefile2
sed -i 's/using namespace std/\/\/\0/g' /wasm/modules/piper-phonemize/build/e/src/espeak_ng_external/src/speechPlayer/src/speechWaveGenerator.cpp
emmake cmake --build build --config Release
```


## Fixed source archive for WordWorkshop 4.7.0

The accompanying [phonemizer-source-4.7.0.tar.gz](https://github.com/Tomorrowhopless/wordworkshop/releases/download/v4.7.0/phonemizer-source-4.7.0.tar.gz) contains full fixed source trees and original notices, build-fixed.sh, the publisher recipe, modified ESM JS source, and SOURCE-EVIDENCE.json. Piper wrapper: cfff8e52ebaea37c7e953ae2d06b174acb827ac4 (default branch wide.video, last change April 2 2024). Its CMake explicitly selects eSpeak engine 0f65aa301e0d6bae5e172cc74197d32a6182200f. Dictionary/voice source tree: 8593723f10cfd9befd50de447f14bf0a9d2a14a4 (default master, last change November 27 2023). Both branch heads predate publisher commit July 5 2024 and remain unchanged.

Publisher original JS/WASM/data SHA256 values exactly match our original assets. Of 494 preloaded data entries, 327 raw lang/voice files were compared against the fixed source tree and all match byte-for-byte; 167 are compiled data outputs not directly compared. The included fixed build adaptation redirects CMake engine fetching to the included local source. It requires separately installed Emscripten 3.1.47 and native build tools. It has not been run locally, and we do not claim byte-for-byte WASM reproduction. Archive hash/size are recorded in provenance.json.
