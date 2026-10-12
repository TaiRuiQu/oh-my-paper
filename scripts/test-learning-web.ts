import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadEnvironment } from "./load-env.mjs";
loadEnvironment();
async function main() {
  const { getDb, disconnectDatabase } = await import("../src/server/db/client");
  const { calculateTotals } = await import("../src/server/grading/score");
  const { gradeResultSchema } = await import("../src/contracts/grading");
  const db = getDb(), base = process.env.BETTER_AUTH_URL!, users: string[] = [], classes: string[] = [], sessions: string[] = [];
  async function request(path: string, cookie: string, data?: unknown, method = data ? "POST" : "GET") {
    return fetch(new URL(path, base), { method, headers: { Cookie: cookie, Origin: new URL(base).origin, ...(data ? { "Content-Type": "application/json" } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  }
  async function account(name: string) {
    const email = `learning-${randomUUID()}@example.com`;
    const payload = { name, email, password: `Learning-${randomUUID()}` };
    let r = await request("/api/auth/sign-up/email", "", payload);
    if (r.status === 429) {
      console.log("Registration rate limit active; waiting for its window before the test.");
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      r = await request("/api/auth/sign-up/email", "", payload);
    }
    assert.equal(r.status,200);
    const data=await r.json();users.push(data.user.id);return {id:data.user.id as string,email,cookie:r.headers.getSetCookie().map((v)=>v.split(";")[0]).join("; ")};
  }
  try {
    const teacher = await account("测试教师"), student = await account("测试学生"), other = await account("无权用户");
    const c = await request("/api/classes", teacher.cookie, {name:"隔离测试班"}); assert.equal(c.status,201); const classroom=await c.json(); classes.push(classroom.id);
    assert.equal((await request("/api/classes/students",other.cookie,{classroomId:classroom.id,name:"冒用",number:"1"})).status,404);
    const s = await request("/api/classes/students",teacher.cookie,{classroomId:classroom.id,name:"测试学生",number:"1",email:student.email}); assert.equal(s.status,201);const profile=await s.json();
    assert.equal((await request("/api/classes/students",teacher.cookie,{classroomId:classroom.id,name:"同学",number:"1"})).status,409);
    const examId=randomUUID(),outputKey=randomUUID();
    const exam = {schemaVersion:"1.0",id:randomUUID(),title:"权限测试卷",subject:"数学",grade:null,sourceFiles:[],pages:[],instructions:[],materials:[],annotations:[],assets:[],verification:{status:"verified",model:"fixture",promptVersion:"fixture",findings:[],corrections:[],usage:{inputTokens:0,outputTokens:0,calls:0}},questions:[{id:"q1",number:"1",section:"",type:"fill_blank",points:5,status:"ready",blocks:[{type:"text",text:"2+3=?"}],options:[],parts:[],materialRefs:[],regions:[{page:1,x:0,y:0,width:1,height:1}]}]};
    await db.examTask.create({data:{id:examId,userId:teacher.id,studentId:profile.id,name:"权限测试卷",status:"COMPLETED",outputKey,jobId:randomUUID(),model:"fixture",providerSnapshot:{},inputFiles:[]}});
    const question={questionId:"q1",number:"1",section:"",studentAnswer:"4",questionText:"2+3=?",sourcePage:1,expectedAnswer:"PRIVATE_REFERENCE_5",referenceOrigin:"supplied",rubric:"PRIVATE_RUBRIC",maxPoints:5,score:0,suggestedScore:0,verdict:"incorrect",feedback:"请核对加法",criteria:[],needsReview:false,reviewReasons:[],failed:false,review:null,reviewHistory:[]};
    const result=gradeResultSchema.parse({schemaVersion:"1.0",examId:exam.id,model:"fixture",promptVersion:"fixture",questions:[question],totals:calculateTotals([question as never]),usage:{inputTokens:0,outputTokens:0,cachedInputTokens:0,cacheWriteTokens:0,calls:0}});
    const grade=await db.gradeTask.create({data:{examTaskId:examId,examOutputKey:outputKey,status:"COMPLETED",jobId:randomUUID(),model:"fixture",promptVersion:"fixture",total:1,input:{exam,submissions:[{questionId:"q1",answer:"4",referenceAnswer:"PRIVATE_REFERENCE_5",rubric:"PRIVATE_RUBRIC",maxPoints:5,unreadable:false,questionConfirmed:true}]},result:JSON.parse(JSON.stringify(result)),providerSnapshot:{}}});
    assert.equal((await request(`/api/grades/${grade.id}`,student.cookie)).status,200);
    assert.equal((await request(`/api/grades/${grade.id}`,other.cookie)).status,404);
    const entries=(await (await request("/api/learning",student.cookie)).json()).entries;assert.equal(entries.length,1);
    const key=entries[0].key;
    assert.equal((await request("/api/practice",other.cookie,{entryKey:key,mode:"original"})).status,404);
    const p=await request("/api/practice",student.cookie,{entryKey:key,mode:"original"});assert.equal(p.status,201);const {id}=await p.json();sessions.push(id);
    const view=await request(`/api/practice/${id}`,student.cookie);const raw=await view.text();assert.ok(!raw.includes("PRIVATE_REFERENCE")&&!raw.includes("PRIVATE_RUBRIC"));assert.equal(JSON.parse(raw).result,null);
    assert.equal((await request(`/api/practice/${id}`,other.cookie)).status,404);
    assert.equal((await request(`/api/grades/${grade.id}`,student.cookie,{questionId:"q1",score:5,maxPoints:5,note:"冒用老师"},"PATCH")).status,404);
    assert.equal((await request(`/api/learning`,student.cookie,{entryKey:key,topicId:"invented"},"PATCH")).status,400);
    assert.equal((await request(`/api/learning`,student.cookie,{entryKey:key,topicId:"arithmetic"},"PATCH")).status,200);
    assert.equal((await request(`/api/grades/${grade.id}`,teacher.cookie,{questionId:"q1",score:5,maxPoints:5,note:"修正测试"},"PATCH")).status,200);
    assert.equal((await (await request("/api/learning",student.cookie)).json()).entries.length,0);
    console.log("Learning passed: student binding, cross-account isolation, answer privacy, topic validation, and score corrections.");
  } finally {
    await db.practiceSession.deleteMany({where:{id:{in:sessions}}});await db.learningTag.deleteMany({where:{userId:{in:users}}});await db.classroom.deleteMany({where:{id:{in:classes}}});await db.user.deleteMany({where:{id:{in:users}}});await disconnectDatabase();
  }
}
main().catch((e)=>{console.error(e instanceof Error?e.message:"Learning integration failed.");process.exitCode=1;});
