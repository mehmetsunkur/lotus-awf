import { runLotusMcpServer, reportMcpError } from "./runtime";
import { registerDesignerTools } from "./tools/designer";

runLotusMcpServer("designer", registerDesignerTools).catch(reportMcpError);

