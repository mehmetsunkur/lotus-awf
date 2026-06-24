import { runLotusMcpServer, reportMcpError } from "./runtime";
import { registerAdminTools } from "./tools/admin";

runLotusMcpServer("admin", registerAdminTools).catch(reportMcpError);

