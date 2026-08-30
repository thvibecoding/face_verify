import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Search,
  ScanLine,
  User,
  FileText,
  Calendar,
  MapPin,
  Building2,
  Globe,
  Link2,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  RefreshCw,
  Camera,
  ExternalLink,
  X,
  Fingerprint,
  AlertCircle,
  Image as ImageIcon,
} from 'lucide-react';
import { supabase, createVerifyLink, checkVerifyStatus, getSignedImageUrl } from '@/lib/supabase';
import type { PersonRecord, VerifyTask } from '@/types';

type SearchState = 'idle' | 'searching' | 'found' | 'notfound';
type LinkState = 'idle' | 'creating' | 'created' | 'error';

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === '通过' ? 'status-pass' : status === '未通过' ? 'status-fail' : 'status-pending';
  const icon =
    status === '通过' ? <CheckCircle2 size={14} /> :
    status === '未通过' ? <XCircle size={14} /> :
    <Clock size={14} />;
  return <span className={`status-badge ${cls}`}>{icon}{status}</span>;
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  return (
    <div className="flex items-start gap-3 py-2.5 px-4 rounded-lg hover:bg-gray-50 transition-colors">
      <div className="flex-shrink-0 mt-0.5 text-gray-400">{icon}</div>
      <div className="min-w-0 flex-1">
        <dt className="text-xs text-gray-500 mb-0.5">{label}</dt>
        <dd className="text-sm font-medium text-gray-900 break-words">{value || '—'}</dd>
      </div>
    </div>
  );
}

export default function App() {
  const [searchInput, setSearchInput] = useState('');
  const [searchState, setSearchState] = useState<SearchState>('idle');
  const [person, setPerson] = useState<PersonRecord | null>(null);
  const [docImageUrl, setDocImageUrl] = useState<string | null>(null);
  const [tasks, setTasks] = useState<VerifyTask[]>([]);
  const [linkState, setLinkState] = useState<LinkState>('idle');
  const [linkError, setLinkError] = useState<string | null>(null);
  const [currentTask, setCurrentTask] = useState<VerifyTask | null>(null);
  const [capturedImageUrl, setCapturedImageUrl] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleSearch = useCallback(async () => {
    const query = searchInput.trim();
    if (!query) return;

    setSearchState('searching');
    setPerson(null);
    setDocImageUrl(null);
    setTasks([]);
    setCurrentTask(null);
    setCapturedImageUrl(null);
    setLinkState('idle');
    setLinkError(null);

    const { data, error } = await supabase
      .from('person_records')
      .select('*')
      .eq('document_no', query)
      .maybeSingle();

    if (error || !data) {
      setSearchState('notfound');
      return;
    }

    setSearchState('found');
    setPerson(data as PersonRecord);

    // Load the document face image via signed URL
    const signedUrl = await getSignedImageUrl(data.document_face_img_url);
    setDocImageUrl(signedUrl);

    // Load existing verification tasks for this person
    const { data: existingTasks } = await supabase
      .from('verify_tasks')
      .select('*')
      .eq('person_id', data.id)
      .order('created_at', { ascending: false });

    if (existingTasks && existingTasks.length > 0) {
      setTasks(existingTasks as VerifyTask[]);
      const latest = existingTasks[0] as VerifyTask;
      if (latest.status === '待核验') {
        setCurrentTask(latest);
      } else {
        setCurrentTask(latest);
        if (latest.image_url) {
          const capturedUrl = await getSignedImageUrl(latest.image_url);
          setCapturedImageUrl(capturedUrl);
        }
      }
    }
  }, [searchInput]);

  const handleGetLink = useCallback(async () => {
    if (!person || !docImageUrl) return;

    setLinkState('creating');
    setLinkError(null);

    try {
      // Download the document face image and convert to base64
      const imgResp = await fetch(docImageUrl);
      const blob = await imgResp.blob();
      const reader = new FileReader();
      const base64: string = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      const result = await createVerifyLink(person.id, base64);

      if (!result.success || !result.sessionUrl || !result.taskId) {
        setLinkState('error');
        setLinkError(result.error || '获取链接失败');
        return;
      }

      setLinkState('created');
      setShowLinkModal(true);

      // Refresh task list
      const { data: freshTasks } = await supabase
        .from('verify_tasks')
        .select('*')
        .eq('person_id', person.id)
        .order('created_at', { ascending: false });

      if (freshTasks) {
        setTasks(freshTasks as VerifyTask[]);
        const newTask = freshTasks.find((t) => t.id === result.taskId);
        if (newTask) setCurrentTask(newTask as VerifyTask);
      }
    } catch {
      setLinkState('error');
      setLinkError('网络错误，请重试');
    }
  }, [person, docImageUrl]);

  const handleCheckStatus = useCallback(async () => {
    if (!currentTask) return;
    setIsChecking(true);

    try {
      const result = await checkVerifyStatus(currentTask.session_id);

      if (result.success) {
        // Refresh task list
        if (person) {
          const { data: freshTasks } = await supabase
            .from('verify_tasks')
            .select('*')
            .eq('person_id', person.id)
            .order('created_at', { ascending: false });

          if (freshTasks) {
            setTasks(freshTasks as VerifyTask[]);
            const updated = freshTasks.find((t) => t.id === currentTask.id);
            if (updated) {
              setCurrentTask(updated as VerifyTask);
              if (updated.status !== '待核验' && updated.image_url) {
                const url = await getSignedImageUrl(updated.image_url);
                setCapturedImageUrl(url);
              }
            }
          }
        }
      }
    } finally {
      setIsChecking(false);
    }
  }, [currentTask, person]);

  // Auto-poll when there's a pending task
  useEffect(() => {
    if (currentTask && currentTask.status === '待核验') {
      pollRef.current = setInterval(() => {
        handleCheckStatus();
      }, 5000);
      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
      };
    }
  }, [currentTask, handleCheckStatus]);

  const handleReset = () => {
    setSearchInput('');
    setSearchState('idle');
    setPerson(null);
    setDocImageUrl(null);
    setTasks([]);
    setCurrentTask(null);
    setCapturedImageUrl(null);
    setLinkState('idle');
    setLinkError(null);
  };

  const currentStatus = currentTask?.status || '待核验';

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-blue-50/30 to-gray-100">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex-shrink-0 w-10 h-10 bg-primary-600 rounded-xl flex items-center justify-center shadow-md shadow-primary-600/20">
              <Fingerprint className="text-white" size={22} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">人脸查验系统</h1>
              <p className="text-xs text-gray-500">证件核验管理后台</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {/* Search Bar */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            扫描或输入证件编号
          </label>
          <div className="flex gap-3">
            <div className="relative flex-1">
              <ScanLine className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                placeholder="请输入证件编号..."
                className="w-full pl-11 pr-4 py-3 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                autoFocus
              />
            </div>
            <button
              onClick={handleSearch}
              disabled={searchState === 'searching' || !searchInput.trim()}
              className="px-6 py-3 bg-primary-600 text-white rounded-xl font-medium text-sm hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-2 shadow-md shadow-primary-600/20"
            >
              {searchState === 'searching' ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Search size={18} />
              )}
              查询
            </button>
            {(person || searchState === 'notfound') && (
              <button
                onClick={handleReset}
                className="px-4 py-3 bg-gray-100 text-gray-600 rounded-xl font-medium text-sm hover:bg-gray-200 transition-all flex items-center gap-2"
              >
                <X size={18} />
                清除
              </button>
            )}
          </div>
          {searchState === 'notfound' && (
            <div className="mt-3 flex items-center gap-2 text-sm text-error-600 bg-error-50 px-4 py-2.5 rounded-lg animate-fade-in">
              <AlertCircle size={16} />
              未找到证件编号为「{searchInput}」的人员档案
            </div>
          )}
        </div>

        {/* Person Detail + Verification Panel */}
        {person && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 animate-slide-up">
            {/* Left Column: Document Photo + Person Info */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
              <div className="bg-gradient-to-r from-primary-50 to-accent-50 px-5 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                  <User size={16} className="text-primary-600" />
                  人员档案信息
                </h2>
              </div>

              {/* Document Face Photo */}
              <div className="p-5 border-b border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">证件人像</span>
                </div>
                <div className="flex justify-center bg-gray-50 rounded-xl p-4 border border-gray-100">
                  {docImageUrl ? (
                    <img
                      src={docImageUrl}
                      alt="证件照"
                      className="max-w-[200px] w-full rounded-lg shadow-md object-contain"
                    />
                  ) : (
                    <div className="w-[200px] h-[260px] flex items-center justify-center bg-gray-100 rounded-lg">
                      <Loader2 size={24} className="animate-spin text-gray-400" />
                    </div>
                  )}
                </div>
              </div>

              {/* Person Info */}
              <dl className="p-3">
                <InfoRow icon={<User size={16} />} label="姓名" value={person.full_name} />
                <InfoRow icon={<FileText size={16} />} label="证件编号" value={person.document_no} />
                <InfoRow icon={<Calendar size={16} />} label="出生日期" value={person.date_of_birth} />
                <InfoRow icon={<User size={16} />} label="性别" value={person.sex} />
                <InfoRow icon={<FileText size={16} />} label="英文姓名" value={person.name_en} />
                <InfoRow icon={<Building2 size={16} />} label="发证机关" value={person.issue_org} />
                <InfoRow icon={<Calendar size={16} />} label="发证日期" value={person.issue_date} />
                <InfoRow icon={<Globe size={16} />} label="国籍" value={person.country} />
                <InfoRow icon={<FileText size={16} />} label="机读码 (MRZ)" value={person.mrz_text} />
              </dl>
            </div>

            {/* Right Column: Captured Face + Verification Actions */}
            <div className="space-y-6">
              {/* Captured Face Photo */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-accent-50 to-primary-50 px-5 py-3 border-b border-gray-100">
                  <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <Camera size={16} className="text-accent-600" />
                    现场拍摄人脸
                  </h2>
                </div>
                <div className="p-5">
                  <div className="flex justify-center bg-gray-50 rounded-xl p-4 border border-gray-100 min-h-[280px] items-center">
                    {capturedImageUrl ? (
                      <img
                        src={capturedImageUrl}
                        alt="现场人脸照片"
                        className="max-w-[200px] w-full rounded-lg shadow-md object-contain animate-fade-in"
                      />
                    ) : currentStatus === '待核验' && currentTask ? (
                      <div className="text-center py-8">
                        <div className="w-16 h-16 mx-auto mb-3 bg-warning-100 rounded-full flex items-center justify-center">
                          <Clock size={28} className="text-warning-600 animate-pulse-slow" />
                        </div>
                        <p className="text-sm text-gray-500">等待核验完成...</p>
                        <p className="text-xs text-gray-400 mt-1">用户尚未完成人脸拍摄</p>
                      </div>
                    ) : !currentTask ? (
                      <div className="text-center py-8">
                        <div className="w-16 h-16 mx-auto mb-3 bg-gray-100 rounded-full flex items-center justify-center">
                          <Camera size={28} className="text-gray-400" />
                        </div>
                        <p className="text-sm text-gray-400">暂无现场照片</p>
                        <p className="text-xs text-gray-400 mt-1">获取链接后用户拍摄将显示在此处</p>
                      </div>
                    ) : (
                      <div className="text-center py-8">
                        <div className="w-16 h-16 mx-auto mb-3 bg-gray-100 rounded-full flex items-center justify-center">
                          <ImageIcon size={28} className="text-gray-400" />
                        </div>
                        <p className="text-sm text-gray-400">未获取到照片</p>
                      </div>
                    )}
                  </div>

                  {/* Status Display */}
                  {currentTask && (
                    <div className="mt-4 flex items-center justify-between px-4 py-3 bg-gray-50 rounded-xl">
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-500">核验状态：</span>
                        <StatusBadge status={currentStatus} />
                      </div>
                      {currentStatus === '待核验' && (
                        <button
                          onClick={handleCheckStatus}
                          disabled={isChecking}
                          className="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1.5 disabled:opacity-50"
                        >
                          {isChecking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                          刷新状态
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Verification Actions */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100">
                  <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    <Link2 size={16} className="text-primary-600" />
                    核验操作
                  </h2>
                </div>
                <div className="p-5 space-y-4">
                  <button
                    onClick={handleGetLink}
                    disabled={linkState === 'creating' || !docImageUrl}
                    className="w-full px-4 py-3 bg-primary-600 text-white rounded-xl font-medium text-sm hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-md shadow-primary-600/20"
                  >
                    {linkState === 'creating' ? (
                      <>
                        <Loader2 size={18} className="animate-spin" />
                        正在创建核验链接...
                      </>
                    ) : (
                      <>
                        <Link2 size={18} />
                        获取链接
                      </>
                    )}
                  </button>

                  {linkState === 'error' && linkError && (
                    <div className="flex items-center gap-2 text-sm text-error-600 bg-error-50 px-4 py-2.5 rounded-lg animate-fade-in">
                      <AlertCircle size={16} />
                      {linkError}
                    </div>
                  )}

                  {currentTask && (
                    <div className="bg-gray-50 rounded-xl p-4 space-y-3 animate-fade-in">
                      <div>
                        <p className="text-xs text-gray-500 mb-1">核验链接</p>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            readOnly
                            value={currentTask.session_url}
                            className="flex-1 px-3 py-2 text-xs bg-white border border-gray-200 rounded-lg text-gray-600 truncate"
                          />
                          <button
                            onClick={() => setShowLinkModal(true)}
                            className="flex-shrink-0 px-3 py-2 bg-primary-50 text-primary-600 rounded-lg text-xs font-medium hover:bg-primary-100 transition-colors flex items-center gap-1"
                          >
                            <ExternalLink size={14} />
                            打开
                          </button>
                        </div>
                      </div>
                      <div className="text-xs text-gray-400">
                        创建时间：{new Date(currentTask.created_at).toLocaleString('zh-CN')}
                      </div>
                    </div>
                  )}

                  {/* History */}
                  {tasks.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">核验历史</p>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {tasks.map((task) => (
                          <div
                            key={task.id}
                            className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg text-xs"
                          >
                            <span className="text-gray-500">
                              {new Date(task.created_at).toLocaleString('zh-CN')}
                            </span>
                            <StatusBadge status={task.status} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {searchState === 'idle' && (
          <div className="text-center py-20">
            <div className="w-20 h-20 mx-auto mb-4 bg-primary-50 rounded-2xl flex items-center justify-center">
              <ScanLine size={36} className="text-primary-400" />
            </div>
            <h3 className="text-base font-medium text-gray-700 mb-1">扫描证件开始查验</h3>
            <p className="text-sm text-gray-400">在上方输入证件编号，系统将自动匹配人员档案</p>
          </div>
        )}
      </main>

      {/* Link Modal */}
      {showLinkModal && currentTask && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setShowLinkModal(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2">
                <Link2 size={18} className="text-primary-600" />
                核验链接
              </h3>
              <button
                onClick={() => setShowLinkModal(false)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-3">
              将以下链接发送给被核验人，或在其设备上打开此链接进行人脸拍摄核验：
            </p>
            <div className="bg-gray-50 rounded-xl p-3 mb-4">
              <p className="text-xs text-gray-600 break-all font-mono">{currentTask.session_url}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(currentTask.session_url);
                }}
                className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-700 rounded-xl font-medium text-sm hover:bg-gray-200 transition-all"
              >
                复制链接
              </button>
              <a
                href={currentTask.session_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 px-4 py-2.5 bg-primary-600 text-white rounded-xl font-medium text-sm hover:bg-primary-700 transition-all flex items-center justify-center gap-2"
              >
                <ExternalLink size={16} />
                打开链接
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
