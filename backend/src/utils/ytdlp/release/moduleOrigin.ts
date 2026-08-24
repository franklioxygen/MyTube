/**
 * Classify where each module of a candidate release actually resolves from.
 *
 * An optional module being absent is fine - the capability is simply
 * unavailable. An optional module resolving *outside* the candidate is not: the
 * release would run against a mutable ambient dependency, which is the version
 * mixing the managed store exists to prevent. The two cases must therefore be
 * reported separately rather than collapsed into one boolean.
 */
export const MODULE_ORIGIN_SCRIPT = [
  "import json, os, sys",
  "root = os.path.realpath(sys.argv[1])",
  "allowed = [root] + [os.path.realpath(p) for p in sys.argv[2:] if p]",
  "def classify(name):",
  "    try:",
  "        module = __import__(name)",
  "    except Exception:",
  "        return 'absent'",
  "    path = getattr(module, '__file__', None)",
  "    if not path:",
  "        return 'absent'",
  "    path = os.path.realpath(path)",
  "    inside = any(path == item or path.startswith(item + os.sep) for item in allowed)",
  "    return 'inside' if inside else 'outside'",
  "optional = ('curl_cffi', 'yt_dlp_ejs')",
  "result = dict((name, classify(name)) for name in ('yt_dlp',) + optional)",
  "print(json.dumps(result))",
  "ok = result['yt_dlp'] == 'inside' and all(result[name] != 'outside' for name in optional)",
  "raise SystemExit(0 if ok else 2)",
].join("\n");
