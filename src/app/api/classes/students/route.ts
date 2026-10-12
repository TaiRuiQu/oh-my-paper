import {requireSession} from "@/server/auth/session";
import {errorResponse} from "@/server/http/errors";
import {readJSON,requireSameOrigin} from "@/server/http/mutations";
import {addStudent,studentInputSchema} from "@/server/learning/classes";
export async function POST(request:Request){try{const {user}=await requireSession(request.headers);requireSameOrigin(request);return Response.json(await addStudent(user.id,await readJSON(request,studentInputSchema)),{status:201});}catch(e){return errorResponse(e);}}
