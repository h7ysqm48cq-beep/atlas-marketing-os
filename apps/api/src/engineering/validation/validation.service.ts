import {
Injectable,
} from "@nestjs/common";

import {
execFile,
} from "node:child_process";

import {
promisify,
} from "node:util";

import {
resolve,
} from "node:path";


import {
execSync,
} from "node:child_process";

import {
ValidationResult,
} from "./validation.types";


const execFileAsync =
promisify(execFile);





@Injectable()
export class ValidationService {


async runTypescriptCheck()
: Promise<ValidationResult> {


const start =
Date.now();


const repositoryRoot =
resolve(
process.cwd(),
"../..",
);


const checks = [
{
name:
"api",

cwd:
resolve(
repositoryRoot,
"apps/api",
),
},
{
name:
"web",

cwd:
resolve(
repositoryRoot,
"apps/web",
),
},
];


const results: {
name: string;
status: "passed" | "failed";
output: string;
}[] = [];


for (
const check of checks
) {


try {


const {
stdout,
stderr,
}
=
await execFileAsync(
resolve(
repositoryRoot,
"node_modules/.bin/tsc",
),
[
"--noEmit",
"-p",
resolve(
check.cwd,
"tsconfig.json",
),
],
{
cwd:
check.cwd,

timeout:
180000,

maxBuffer:
20 * 1024 * 1024,
},
);


results.push({

name:
check.name,

status:
"passed",

output:
stdout || stderr,

});


}
catch(error){


results.push({

name:
check.name,

status:
"failed",

output:
error instanceof Error
?
error.message
:
"Validation failed",

});


}


}


const failed =
results.some(
(item) =>
item.status === "failed",
);


return {

status:
failed
?
"failed"
:
"passed",

command:
"node_modules/.bin/tsc --noEmit",

output:
JSON.stringify(
results,
null,
2,
),

duration:
Date.now() - start,

};


}


}
