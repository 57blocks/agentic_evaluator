import { Route, Routes } from "react-router-dom";
import { BoardPage } from "./pages/BoardPage";
import { MembersPage } from "./pages/MembersPage";
import { NewTaskPage } from "./pages/NewTaskPage";
import { TaskDetailPage } from "./pages/TaskDetailPage";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<BoardPage />} />
      <Route path="/tasks/new" element={<NewTaskPage />} />
      <Route path="/tasks/:taskId" element={<TaskDetailPage />} />
      <Route path="/members" element={<MembersPage />} />
    </Routes>
  );
}
