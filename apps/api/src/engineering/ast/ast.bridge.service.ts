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
export class AstBridgeService {


async analyze(
  filePath:string,
){

  const {
    stdout,
  } =
  await execFileAsync(
    "python3",
    [
      "-m",
      "tools.modifier.bridge",

      "--file",
      filePath,
    ],
    {
      cwd:
        process.cwd(),

      timeout:
        120000,

      maxBuffer:
        10 * 1024 * 1024,
    },
  );


  return JSON.parse(
    stdout,
  );

}


}
