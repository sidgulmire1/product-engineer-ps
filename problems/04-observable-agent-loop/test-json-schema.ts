import { searchLogsSchema } from './src/lib/tools/search-logs.ts';
import { zodToJsonSchema } from 'zod-to-json-schema';
console.log(JSON.stringify(zodToJsonSchema(searchLogsSchema, { target: "jsonSchema7" }), null, 2));
