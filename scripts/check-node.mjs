const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 12)) {
  console.error(
    `Slate requires Node.js 22.12 or newer.\n` +
      `Current version: ${process.versions.node}\n` +
      `Executable: ${process.execPath}\n\n` +
      `Switch this terminal to Node.js 22 or 24, then rerun the command.\n` +
      `If you use nvm, run: nvm install && nvm use`,
  );
  process.exit(1);
}
if (process.features?.require_module === false) {
  console.error(
    "Slate needs Node.js ESM require support. Remove --no-experimental-require-module from NODE_OPTIONS or the Node command.",
  );
  process.exit(1);
}
