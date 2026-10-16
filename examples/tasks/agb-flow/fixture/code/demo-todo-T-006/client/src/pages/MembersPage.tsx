import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { createMember, fetchMembers, removeMember, type Member } from "../api/members";

type LoadState = "loading" | "error" | "ready";

export function MembersPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");

  const [newName, setNewName] = useState("");
  const [addError, setAddError] = useState("");
  const [isAdding, setIsAdding] = useState(false);

  const [pendingRemovalId, setPendingRemovalId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState("");

  useEffect(() => {
    let isCancelled = false;
    fetchMembers()
      .then((result) => {
        if (isCancelled) return;
        setMembers(result);
        setLoadState("ready");
      })
      .catch((error: unknown) => {
        if (isCancelled) return;
        setLoadError(error instanceof Error ? error.message : "加载失败");
        setLoadState("error");
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  async function handleAddMember(event: FormEvent) {
    event.preventDefault();
    const name = newName.trim();
    if (!name || isAdding) return;

    setIsAdding(true);
    setAddError("");
    try {
      const created = await createMember(name);
      setMembers((current) => [...current, created]);
      setNewName("");
    } catch (error: unknown) {
      setAddError(error instanceof Error ? error.message : "添加失败");
    } finally {
      setIsAdding(false);
    }
  }

  async function handleConfirmRemove(memberId: string) {
    setRemoveError("");
    try {
      await removeMember(memberId);
      setMembers((current) => current.filter((member) => member.id !== memberId));
      setPendingRemovalId(null);
    } catch (error: unknown) {
      setRemoveError(error instanceof Error ? error.message : "移除失败");
    }
  }

  return (
    <div>
      <Link to="/" data-testid="members-back-link">
        返回看板
      </Link>
      <h1>成员管理</h1>

      {loadState === "loading" && <div data-testid="members-loading">加载中…</div>}
      {loadState === "error" && <div data-testid="members-error">{loadError}</div>}

      {loadState === "ready" && (
        <>
          {removeError && <div data-testid="members-error">{removeError}</div>}
          {members.length === 0 ? (
            <div data-testid="members-empty">还没有成员，先添加一位</div>
          ) : (
            <ul>
              {members.map((member) => (
                <li key={member.id} data-testid="member-row" data-member-id={member.id}>
                  {member.name}
                  <button
                    type="button"
                    data-testid="member-remove-button"
                    data-member-id={member.id}
                    onClick={() => setPendingRemovalId(member.id)}
                  >
                    移除
                  </button>
                  {pendingRemovalId === member.id && (
                    <span>
                      确认移除该成员？
                      <button
                        type="button"
                        data-testid="member-remove-confirm-button"
                        onClick={() => handleConfirmRemove(member.id)}
                      >
                        确认
                      </button>
                      <button type="button" onClick={() => setPendingRemovalId(null)}>
                        取消
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <form onSubmit={handleAddMember}>
        <input
          data-testid="new-member-name-input"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
        />
        <button type="submit" data-testid="add-member-button" disabled={isAdding}>
          添加成员
        </button>
        {addError && <div data-testid="new-member-name-error">{addError}</div>}
      </form>
    </div>
  );
}
