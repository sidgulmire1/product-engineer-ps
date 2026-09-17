import { tool } from 'ai';
import { z } from 'zod';

const x = tool({
  description: "test",
  inputSchema: z.object({}),
});
