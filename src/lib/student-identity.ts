/** Shared print geometry: six handwritten exam-number digits and ten choices per digit. */
export function renderStudentIdentitySvg() {
  const columns = Array.from({ length: 6 }, (_, column) => {
    const x = 363 + column * 34;
    return `<rect x="${x}" y="22" width="26" height="23" fill="none" stroke="#111"/>${Array.from({ length: 10 }, (_, digit) => `<rect x="${x + 3}" y="${52 + digit * 11}" width="20" height="9" rx="3" fill="white" stroke="#333" stroke-width="0.7"/><text x="${x + 13}" y="${59 + digit * 11}" text-anchor="middle" font-size="8">${digit}</text>`).join("")}`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 574 170" width="574" height="170" role="img" aria-label="姓名、班级与六位考号填写及填涂区"><g fill="#111" font-family="Noto Sans SC,SimSun,sans-serif" font-size="13"><text x="4" y="32">姓名：________________________</text><text x="4" y="66">班级：________________________</text><text x="4" y="100">考号：________________________</text><text x="4" y="137" font-size="10">请填写六位考号，并用铅笔填满右侧对应数字。</text><text x="4" y="154" font-size="10">考号与班级名册中的学号一致，不足六位在前面补 0。</text><text x="363" y="15" font-size="11">考号填写与填涂区（每列填一位）</text>${columns}</g></svg>`;
}
