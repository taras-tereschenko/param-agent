import { defineTool } from "eve/tools";
import { grep } from "eve/tools/defaults";
import { grepApproval } from "../lib/tool-approval.js";

export default defineTool({
  ...grep,
  approval: grepApproval(),
  async execute(input, ctx) {
    return grep.execute(input, ctx);
  },
});
