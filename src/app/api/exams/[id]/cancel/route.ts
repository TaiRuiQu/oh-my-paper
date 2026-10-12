import {requireSession} from "@/server/auth/session";
import {errorResponse,RequestError} from "@/server/http/errors";
import {requireSameOrigin} from "@/server/http/mutations";
import {ownedExamTask} from "@/server/exams/tasks";
import {getDb} from "@/server/db/client";
import {getJobProducer} from "@/server/jobs/client";
import {EXAM_PARSE_QUEUE} from "@/contracts/exam-tasks";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){try{const {user}=await requireSession(request.headers);requireSameOrigin(request);const task=await ownedExamTask(user.id,(await params).id);if(!(await getDb().examTask.updateMany({where:{id:task.id,jobId:task.jobId,status:{in:["QUEUED","RUNNING"]}},data:{status:"FAILED",phase:"cancelled",error:"已取消识别。可以重新提交。"}})).count)throw new RequestError(409,"任务已经结束，请刷新页面。");await(await getJobProducer()).cancel(EXAM_PARSE_QUEUE,task.jobId);return Response.json({ok:true});}catch(e){return errorResponse(e);}}
