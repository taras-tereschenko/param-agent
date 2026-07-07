import { disableTool } from "eve/tools";

// The researcher runs autonomously; it must not have ungated shell access
// (a declared subagent would otherwise fall back to the ungated framework bash).
export default disableTool();
