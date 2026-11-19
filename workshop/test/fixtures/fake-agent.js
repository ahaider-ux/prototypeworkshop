// A stand-in for a coding agent in tests: it edits overrides.css in the folder it runs in.
import fs from "node:fs";

const request = process.argv[2] || "";
fs.appendFileSync("overrides.css", "\np.t {\n  color: var(--text-accent, #5266ba) !important;\n}\n");
process.stdout.write(`Working on: ${request}\n\nMade the selected text use the accent colour.\n`);
