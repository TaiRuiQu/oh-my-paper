"use client";
import {useState,type FormEvent} from "react";
import type { ExamQuestion } from "@/contracts/exams";
import {blocksToText} from "@/lib/grading-defaults";
import {apiRequest,jsonBody} from "@/lib/http-client";
export function QuestionEditor({question,examId,outputKey,onSaved}:{question:ExamQuestion;examId:string;outputKey:string;onSaved:()=>Promise<unknown>}){
  const editable=question.blocks.filter((b)=>b.type!=="figure"&&b.type!=="table");
  const [text,setText]=useState(blocksToText(editable));const [points,setPoints]=useState(String(question.points??""));const [confirmed,setConfirmed]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError("");try{await apiRequest(`/api/exams/${examId}`,{method:"PATCH",...jsonBody({outputKey,questionId:question.id,points:points===""?null:Number(points),confirmed,blocks:[{type:"text",text},...question.blocks.filter((b)=>b.type==="figure"||b.type==="table")]})});await onSaved();}catch(e){setError(e instanceof Error?e.message:"修改未保存，请重试。");}finally{setBusy(false);}}
  return <details className="advanced-settings"><summary>修正题干与分值</summary><form onSubmit={submit}><fieldset disabled={busy}><div className="field"><label htmlFor={`edit-${question.id}`}>题干</label><textarea id={`edit-${question.id}`} rows={4} required maxLength={12000} value={text} onChange={(e)=>setText(e.target.value)}/></div><div className="field"><label htmlFor={`points-${question.id}`}>本题满分</label><input id={`points-${question.id}`} type="number" min={0} max={1000} step="0.01" value={points} onChange={(e)=>setPoints(e.target.value)}/></div><label className="checkbox-field"><input type="checkbox" checked={confirmed} onChange={(e)=>setConfirmed(e.target.checked)}/>已对照原图核对题干、选项与小题</label><button className="button secondary">{busy?"保存中…":"保存修正"}</button></fieldset>{error&&<p className="form-error" role="alert">{error}</p>}</form></details>;
}
