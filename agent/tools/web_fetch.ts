import { defineTool } from "eve/tools";
import { webFetch } from "eve/tools/defaults";
import { manualApproveTool } from "../lib/tool-approval.js";

export default defineTool({
  ...webFetch,
  approval: manualApproveTool(),
  async execute(input, ctx) {
    return webFetch.execute(input, ctx);
  },
});
