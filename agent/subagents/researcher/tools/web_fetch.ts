import { disableTool } from "eve/tools";

// Provider-managed web_search stays enabled as the current-info path; arbitrary
// URL fetching does not, matching Param's own approval policy.
export default disableTool();
