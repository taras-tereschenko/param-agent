import { defineTool } from "eve/tools";
import { glob } from "eve/tools/defaults";
import { globApproval } from "../lib/tool-approval.js";

export default defineTool({
  ...glob,
  approval: globApproval(),
  async execute(input, ctx) {
    return glob.execute(input, ctx);
  },
});
