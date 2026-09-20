const { withDangerousMod, withPodfileProperties } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Lets a target use the system SQLite while SQLCipher is also linked.
 *
 * SQLCipher — pulled in by the XMTP SDK — is an sqlite3 amalgamation, and
 * CocoaPods propagates its include guards (`_SQLITE3_H_`, `_SQLITE3RTREE_H_`)
 * to every target that links it, the app target included. With those already
 * defined, the iOS SDK's own `sqlite3.h` expands to nothing, so any target that
 * builds the system `SQLite3` module gets `sqlite3ext.h` with no `sqlite3` type
 * behind it and fails with 19 "unknown type name" errors.
 *
 * Nothing imported SQLite3 until expo-observe arrived — `expo-app-metrics`
 * keeps its metrics in one — which is why this only started mattering then.
 *
 * Stripping the guards from the *app* target is safe: they exist to stop
 * SQLCipher's amalgamation re-including itself while SQLCipher is compiled,
 * which happens in SQLCipher's own target and is untouched here.
 *
 * This lives in a config plugin rather than in `ios/Podfile` because `ios/` is
 * generated — a hand-edited Podfile is lost on the next prebuild, and the build
 * breaks again with an error that says nothing about SQLCipher.
 */
const HOOK = `
    # Added by plugins/with-sqlcipher-sqlite-fix.js — see that file for why.
    installer.aggregate_targets.each do |aggregate_target|
      aggregate_target.user_build_configurations.each_key do |config_name|
        path = aggregate_target.xcconfig_path(config_name)
        next unless File.exist?(path)

        contents = File.read(path)
        patched = contents.gsub(/^(GCC_PREPROCESSOR_DEFINITIONS = .*)$/) do |line|
          line.split(' ').reject { |token|
            token.start_with?('_SQLITE3_H_', '_SQLITE3RTREE_H_')
          }.join(' ')
        end
        File.write(path, patched) unless patched == contents
      end
    end
`;

const MARKER = 'with-sqlcipher-sqlite-fix.js';

// Expo prefixes its public SQLite functions with `ex`, but SDK 57's SQLCipher
// amalgamation still exports these unprefixed symbols. XMTP carries a different
// SQLCipher version: sharing codec/pager functions crosses private struct layouts
// and crashes in sqlite3_step. Isolate the remaining exports in Expo's pod only.
// Verified against `nm -gU libExpoSQLite.a`; recheck when upgrading expo-sqlite.
const EXPO_SQLCIPHER_EXPORTS = `
sqlcipherCodecAttach sqlcipherCodecGetKey sqlcipherPagerCodec
sqlcipherPagerGetCodec sqlcipherPagerSetCodec sqlcipher_cc_setup
sqlcipher_codec_pragma sqlcipher_extra_init sqlcipher_extra_shutdown
sqlcipher_find_db_index sqlcipher_free sqlcipher_get_provider
sqlcipher_init_memmethods sqlcipher_ismemset sqlcipher_log sqlcipher_malloc
sqlcipher_memcmp sqlcipher_memset sqlcipher_mutex sqlcipher_register_provider
sqlcipher_version sqlite3_data_directory sqlite3_temp_directory sqlite3_version
sqlite3changegroup_add sqlite3changegroup_add_change sqlite3changegroup_add_strm
sqlite3changegroup_delete sqlite3changegroup_new sqlite3changegroup_output
sqlite3changegroup_output_strm sqlite3changegroup_schema sqlite3pager_error
sqlite3pager_is_sj_pgno sqlite3pager_reset sqlite3rebaser_configure
sqlite3rebaser_create sqlite3rebaser_delete sqlite3rebaser_rebase sqlite3rebaser_rebase_strm
`.trim().split(/\s+/);

module.exports = function withSqlcipherSqliteFix(config) {
  config = withPodfileProperties(config, (modConfig) => {
    const key = 'expo.sqlite.customBuildFlags';
    const flags = new Set((modConfig.modResults[key] ?? '').split(/\s+/).filter(Boolean));
    for (const symbol of EXPO_SQLCIPHER_EXPORTS) flags.add(`-D${symbol}=ex${symbol}`);
    modConfig.modResults[key] = [...flags].join(' ');
    return modConfig;
  });
  return withDangerousMod(config, [
    'ios',
    (modConfig) => {
      const podfile = path.join(modConfig.modRequest.platformProjectRoot, 'Podfile');
      const contents = fs.readFileSync(podfile, 'utf8');

      // Idempotent: prebuild runs this on a Podfile that may already carry it.
      if (contents.includes(MARKER)) return modConfig;

      const opener = '  post_install do |installer|\n';
      if (!contents.includes(opener)) {
        throw new Error(
          'with-sqlcipher-sqlite-fix: no `post_install do |installer|` block in the Podfile. ' +
            'The Expo template changed shape — update this plugin rather than dropping it, ' +
            'or the iOS build fails on sqlite3ext.h with no hint as to why.'
        );
      }

      // Appended at the *end* of post_install, not the start:
      // `react_native_post_install` rewrites the same xcconfigs, so a strip that
      // runs before it is simply overwritten and the build fails exactly as it
      // did without the plugin.
      const closer = contents.lastIndexOf('\n  end');
      if (closer === -1 || closer < contents.indexOf(opener)) {
        throw new Error(
          'with-sqlcipher-sqlite-fix: could not find the end of the post_install block.'
        );
      }

      fs.writeFileSync(podfile, contents.slice(0, closer) + '\n' + HOOK + contents.slice(closer));
      return modConfig;
    },
  ]);
};
