import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { fetchMembers, type Member } from "../api/members";
import { createTask } from "../api/tasks";

const UNASSIGNED_VALUE = "";

export function NewTaskPage() {
  const navigate = useNavigate();

  const [members, setMembers] = useState<Member[]>([]);

  const [title, setTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState(UNASSIGNED_VALUE);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    let isCancelled = false;
    fetchMembers()
      .then((result) => {
        if (isCancelled) return;
        setMembers(result);
      })
      .catch(() => {
        // member roster is optional context for this form; leave the select at 未分配-only
      });
    return () => {
      isCancelled = true;
    };
  }, []);

  const trimmedTitle = title.trim();
  const showTitleError = titleTouched && !trimmedTitle;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!trimmedTitle || isSubmitting) return;

    setIsSubmitting(true);
    setSubmitError("");
    try {
      await createTask({
        title: trimmedTitle,
        description,
        assigneeId: assigneeId === UNASSIGNED_VALUE ? null : assigneeId,
      });
      navigate("/");
    } catch (error: unknown) {
      setSubmitError(error instanceof Error ? error.message : "创建失败");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div>
      <h1>新建任务</h1>

      {submitError && <div data-testid="new-task-error">{submitError}</div>}

      <form onSubmit={handleSubmit}>
        <input
          data-testid="new-task-title-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={() => setTitleTouched(true)}
        />
        {showTitleError && <div data-testid="new-task-title-error">标题必填</div>}

        <textarea
          data-testid="new-task-description-textarea"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />

        <select
          data-testid="new-task-assignee-select"
          value={assigneeId}
          onChange={(event) => setAssigneeId(event.target.value)}
        >
          <option value={UNASSIGNED_VALUE}>未分配</option>
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>

        <button type="submit" data-testid="new-task-submit-button" disabled={!trimmedTitle || isSubmitting}>
          创建
        </button>
        <button type="button" data-testid="new-task-cancel-button" onClick={() => navigate("/")}>
          取消
        </button>
      </form>
    </div>
  );
}
