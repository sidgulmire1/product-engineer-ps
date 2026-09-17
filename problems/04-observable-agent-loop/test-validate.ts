import { jsonSchema } from 'ai';
console.log(jsonSchema({}, {
  validate: (v) => { return { success: true, value: v }; }
}));
