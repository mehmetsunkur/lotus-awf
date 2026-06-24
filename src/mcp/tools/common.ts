import { z } from "zod";

export const appIdSchema = {
  appId: z.string().min(1).describe("Installed business app id, without the .nsf suffix")
};

export const jsonObjectSchema = z.record(z.string(), z.any());

