import { defineTool } from "eve/tools";
import { bash } from "eve/tools/defaults";
import { manualApproveTool } from "../lib/tool-approval.js";

export default defineTool({
  ...bash,
  approval: manualApproveTool(),
  async execute(input, ctx) {
    return bash.execute(input, ctx);
  },
});
