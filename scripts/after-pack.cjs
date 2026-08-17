const { spawnSync } = require("node:child_process");
const path = require("node:path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  const result = spawnSync(
    "codesign",
    ["--force", "--deep", "--sign", "-", "--timestamp=none", appPath],
    { stdio: "inherit" }
  );

  if (result.status !== 0) {
    throw new Error(`ad-hoc codesign failed with exit code ${result.status}`);
  }
};
