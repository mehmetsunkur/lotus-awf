import { runLotusMcpServer, reportMcpError } from "./runtime";
import { registerWorkspaceTools } from "./tools/workspace";

runLotusMcpServer("workspace", registerWorkspaceTools).catch(reportMcpError);

