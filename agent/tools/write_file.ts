import { defineTool } from "eve/tools";
import { writeFile } from "eve/tools/defaults";
import { manualApproveTool } from "../lib/tool-approval.js";

export default defineTool({
  ...writeFile,
  approval: manualApproveTool(),
  async execute(input, ctx) {
    return writeFile.execute(input, ctx);
  },
});
