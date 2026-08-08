import {
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

type TelegramApiResponse<T> = { ok:boolean; result?:T; description?:string; error_code?:number };
type TelegramUser = { id:number; is_bot:boolean; first_name:string; username?:string };
type TelegramChat = { id:number; type:string; title?:string; username?:string };
type TelegramMessage = { message_id:number; date:number; chat:TelegramChat; text?:string };

@Injectable()
export class TelegramConnectorService {
  constructor(private readonly configService: ConfigService) {}
  async testConnection(){const bot=await this.call<TelegramUser>('getMe',{});const chatId=this.getChatId();const chat=await this.call<TelegramChat>('getChat',{chat_id:chatId});return{connected:true,bot:{id:bot.id,name:bot.first_name,username:bot.username??null},channel:{id:chat.id,title:chat.title??null,username:chat.username??null,type:chat.type}}}
  async sendTestMessage(){const result=await this.sendMessage('✅ Atlas Telegram connection test successful.');return{published:true,messageId:result.message_id,chatId:result.chat.id,sentAt:new Date(result.date*1000).toISOString()}}
  async publish(text:string,mediaUrls:string[]=[]){const first=mediaUrls.map(u=>u?.trim()).find(Boolean);return first?this.sendPhoto(text,first):this.sendMessage(text)}
  async sendPhoto(caption:string,mediaUrl:string){const clean=caption?.trim();if(!clean)throw new BadRequestException('Telegram caption cannot be empty.');const media=await this.fetchMedia(mediaUrl);const form=new FormData();form.set('chat_id',this.getChatId());form.set('caption',clean);form.set('photo',media.blob,media.filename);return this.callMultipart<TelegramMessage>('sendPhoto',form)}
  async sendMessage(text:string){const clean=text?.trim();if(!clean)throw new BadRequestException('Telegram message cannot be empty.');return this.call<TelegramMessage>('sendMessage',{chat_id:this.getChatId(),text:clean,disable_web_page_preview:false})}
  private getToken(){const token=this.configService.get<string>('TELEGRAM_BOT_TOKEN');if(!token||token==='PASTE_YOUR_BOT_TOKEN_HERE')throw new BadRequestException('TELEGRAM_BOT_TOKEN is not configured.');return token.trim()}
  private getChatId(){const id=this.configService.get<string>('TELEGRAM_CHAT_ID');if(!id?.trim())throw new BadRequestException('TELEGRAM_CHAT_ID is not configured.');return id.trim()}
  private async fetchMedia(mediaUrl:string){const clean=mediaUrl?.trim();if(!clean)throw new BadRequestException('Telegram media URL is required.');if(clean.startsWith('data:image/'))return this.dataImage(clean,'atlas-sports-news');let response:Response;try{response=await fetch(clean)}catch(error){throw new BadRequestException(`Unable to read Telegram media: ${error instanceof Error?error.message:'Unknown media fetch error'}`)}if(!response.ok)throw new BadRequestException(`Unable to read Telegram media. HTTP ${response.status}`);const type=response.headers.get('content-type')||'application/octet-stream';if(!type.startsWith('image/'))throw new BadRequestException(`Telegram media must be an image. Received ${type}.`);const pathname=new URL(clean).pathname;const filename=pathname.split('/').pop()||'atlas-image';return{filename,blob:new Blob([await response.arrayBuffer()],{type})}}
  private dataImage(value:string,name:string){const match=/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(value);if(!match)throw new BadRequestException('Invalid generated image data.');const type=match[1];const bytes=Buffer.from(match[2],'base64');const ext=type==='image/jpeg'?'jpg':type.split('/')[1]?.replace('jpeg','jpg')||'png';return{filename:`${name}.${ext}`,blob:new Blob([bytes],{type})}}
  private async callMultipart<T>(method:string,form:FormData):Promise<T>{const response=await fetch(`https://api.telegram.org/bot${this.getToken()}/${method}`,{method:'POST',body:form});const body=await response.json() as TelegramApiResponse<T>;if(!response.ok||!body.ok)throw new BadRequestException(body.description||`Telegram API request failed: ${method}`);if(body.result===undefined)throw new BadRequestException(`Telegram API returned no result: ${method}`);return body.result}
  private async call<T>(method:string,payload:Record<string,unknown>):Promise<T>{const response=await fetch(`https://api.telegram.org/bot${this.getToken()}/${method}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const body=await response.json() as TelegramApiResponse<T>;if(!response.ok||!body.ok)throw new BadRequestException(body.description||`Telegram API request failed: ${method}`);if(body.result===undefined)throw new BadRequestException(`Telegram API returned no result: ${method}`);return body.result}
}
