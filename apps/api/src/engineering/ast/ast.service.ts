import {
  Injectable,
} from "@nestjs/common";

import {
  execFile,
} from "node:child_process";

import {
  promisify,
} from "node:util";


const execFileAsync =
  promisify(execFile);


@Injectable()
export class AstService {


async generatePatch(
request:string,
filePath:string,
){


const {
 stdout,
} =
await execFileAsync(
"python3",
[
"tools/modifier/bridge_editor.py",

"--file",
filePath,

"--request",
request,
],
{
cwd:
process.cwd(),
timeout:
120000,
},
);


return JSON.parse(
stdout,
);


}


}
