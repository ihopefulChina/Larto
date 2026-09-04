// electron-builder `afterPack` hook (electron-builder.yml).
//
// Without a Developer ID certificate electron-builder leaves the .app unsigned, and Electron's
// own executables still carry ad-hoc signatures whose resource seals no longer match the
// repackaged bundle. On Apple Silicon, Gatekeeper reports such a bundle as "damaged" the first
// time it is opened from a downloaded (quarantined) DMG, with no way to override short of
// `xattr -cr`. A consistent ad-hoc signature turns that into the ordinary "unidentified
// developer" prompt, which the user can approve in System Settings → Privacy & Security.
//
// When a real identity is configured (CSC_LINK / CSC_NAME), electron-builder signs after this
// hook with `codesign --force`, replacing the ad-hoc signature, so the hook simply steps aside.
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

export async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return
  if (process.env.CSC_LINK || process.env.CSC_NAME) return
  const appPath = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' })
  console.log(`  • ad-hoc signed ${appPath} (no signing identity configured)`)
}

export default afterPack
