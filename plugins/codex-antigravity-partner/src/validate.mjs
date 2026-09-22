import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

const schemaPath = path.join(__dirname, '..', 'schemas', 'delegated-result.schema.json');
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const validate = ajv.compile(schema);

export function validateResult(obj) {
  const valid = validate(obj);
  const errors = validate.errors ? validate.errors.map(e => `${e.instancePath} ${e.message}`) : [];
  return { valid, errors };
}
