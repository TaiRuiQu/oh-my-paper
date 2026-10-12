import {requirePageSession} from "@/server/auth/session";
import {classOverview} from "@/server/learning/classes";
import {Classes} from "@/components/classes";
export const metadata={title:"班级管理"};
export default async function Page(){const {user}=await requirePageSession();return <Classes initialClasses={await classOverview(user.id)}/>;}
