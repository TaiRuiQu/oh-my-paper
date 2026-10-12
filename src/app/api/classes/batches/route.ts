import {z} from "zod";
import {requireSession} from "@/server/auth/session";
import {getDb} from "@/server/db/client";
import {errorResponse} from "@/server/http/errors";
import {readJSON,requireSameOrigin} from "@/server/http/mutations";
import {ownedClass} from "@/server/learning/classes";
export async function POST(request:Request){try{const {user}=await requireSession(request.headers);requireSameOrigin(request);const data=await readJSON(request,z.object({classroomId:z.uuid(),name:z.string().trim().min(1).max(80)}));await ownedClass(user.id,data.classroomId);return Response.json(await getDb().gradeBatch.create({data}),{status:201});}catch(e){return errorResponse(e);}}
