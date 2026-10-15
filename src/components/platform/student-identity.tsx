import { renderStudentIdentitySvg } from "@/lib/student-identity";

export function StudentIdentity() {
  return (
    <div
      className="p-student-identity"
      dangerouslySetInnerHTML={{ __html: renderStudentIdentitySvg() }}
    />
  );
}
