import { replicateBidirectional } from "../src/server/couch";

async function main() {
  const result = await replicateBidirectional();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
