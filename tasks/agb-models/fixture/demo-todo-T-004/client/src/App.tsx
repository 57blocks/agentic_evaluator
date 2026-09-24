import { Link, Route, Routes } from "react-router-dom";
import { MembersPage } from "./pages/MembersPage";
import { NewTaskPage } from "./pages/NewTaskPage";

function BoardPlaceholder() {
  return (
    <div>
      <h1>看板（建设中）</h1>
      <Link to="/members" data-testid="members-link">
        成员管理
      </Link>
    </div>
  );
}

function TaskDetailPlaceholder() {
  return <div>任务详情（建设中）</div>;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<BoardPlaceholder />} />
      <Route path="/tasks/new" element={<NewTaskPage />} />
      <Route path="/tasks/:taskId" element={<TaskDetailPlaceholder />} />
      <Route path="/members" element={<MembersPage />} />
    </Routes>
  );
}
