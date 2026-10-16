export interface Member {
  id: string;
  name: string;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // response had no JSON body
  }
  return "请求失败";
}

export async function fetchMembers(): Promise<Member[]> {
  const response = await fetch("/api/members");
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  const body: { members: Member[] } = await response.json();
  return body.members;
}

export async function createMember(name: string): Promise<Member> {
  const response = await fetch("/api/members", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  return response.json();
}

export async function removeMember(memberId: string): Promise<void> {
  const response = await fetch(`/api/members/${memberId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
}
