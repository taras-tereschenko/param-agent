import { defineTool } from "eve/tools";
import { readFile } from "eve/tools/defaults";
import { readFileApproval } from "../lib/tool-approval.js";

export default defineTool({
  ...readFile,
  approval: readFileApproval(),
  async execute(input, ctx) {
    return readFile.execute(input, ctx);
  },
});
