import { createAgentServer } from "./http.ts";

const token = process.env.TEAM_TOKEN;
if (!token) throw new Error("TEAM_TOKEN must be configured");
const port = Number(process.env.PORT ?? 3000);
const { server } = createAgentServer({ token });
server.listen(port, "0.0.0.0", () => {
	console.log(`Frontier agent listening on port ${port}`);
});
