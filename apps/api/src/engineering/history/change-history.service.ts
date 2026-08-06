import {
  Injectable,
} from "@nestjs/common";


export type ChangeHistoryItem = {
  id: string;
  filePath: string;
  action: string;
  status: string;
  createdAt: string;
};


@Injectable()
export class ChangeHistoryService {

  private readonly changes:
    ChangeHistoryItem[] = [];


  add(
    item: ChangeHistoryItem,
  ) {
    this.changes.unshift(
      item,
    );

    return item;
  }


  list() {
    return this.changes;
  }
}
