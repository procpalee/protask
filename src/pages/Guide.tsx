import { Inbox, Sun, CalendarDays, Moon, CalendarRange, LayoutGrid, PanelsTopLeft } from 'lucide-react'
import { SHORTCUTS } from '../components/Shortcuts'

/** 사용 설명서 — GTD 구현 방식과 태스크·프로젝트 관계 중심 */
export default function GuidePage() {
  return (
    <div className="mx-auto max-w-[760px] px-5 py-6">
      <h1 className="mb-1 text-[21px] font-bold tracking-tight">사용 설명서</h1>
      <p className="mb-6 text-[14px] text-zinc-500 dark:text-zinc-400">
        이 앱은 <b>프로젝트 관리</b>(워크스페이스▸Phase▸프로젝트▸태스크)와 <b>GTD 할일관리</b>(Inbox·Today·Scheduled·Someday)를
        하나로 합친 도구입니다. 핵심은 “모든 할 일은 <b>태스크</b> 하나로 관리되고, 프로젝트는 그 태스크에 붙는 맥락”이라는 점입니다.
      </p>

      <Section title="태스크와 프로젝트의 관계">
        <ul className="ml-4 list-disc space-y-1.5">
          <li><b>태스크(Task)</b>가 모든 할 일의 기본 단위입니다. 두 종류가 있습니다:
            <ul className="ml-5 mt-1 list-[circle] space-y-1">
              <li><b>프로젝트 하위 태스크</b> — 특정 프로젝트에 속한 태스크. 그 프로젝트의 칸반 보드에 나타납니다.</li>
              <li><b>일반 태스크</b> — 프로젝트가 없는 단독 할 일. 칸반에는 없고, Inbox·Today 등 GTD 화면에서 “미분류”로 관리합니다.</li>
            </ul>
          </li>
          <li><b>프로젝트 배정은 “태그”입니다.</b> 태스크에 프로젝트를 달아도 GTD 흐름(Inbox/Today/…)에서 사라지지 않습니다.
            태스크가 어디에 “나타나는지”는 오직 <b>날짜·Someday</b>가 결정하고, 프로젝트는 그 태스크가 “무엇에 관한 것인지”를 라벨로 보여줄 뿐입니다.</li>
          <li><b>계층</b>: 워크스페이스 ▸ Phase ▸ 프로젝트 ▸ 태스크 ▸ 서브태스크(체크리스트).
            워크스페이스는 가장 큰 묶음(예: “제품 개발”), Phase는 그 안의 단계, 프로젝트는 실제 작업 단위입니다.</li>
        </ul>
      </Section>

      <Section title="GTD를 이렇게 구현했습니다">
        <p className="mb-2">할 일은 “수집 → 분류 → 실행”의 흐름을 탑니다. 각 화면이 그 단계입니다:</p>
        <div className="space-y-2">
          <Row icon={<Inbox size={15} />} name="Inbox (수집)">
            떠오르는 모든 것을 일단 담는 곳. <b>날짜도 Someday도 없는 활성 태스크</b>가 전부 모입니다.
            여기서 각 태스크를 Today/Scheduled/Someday 중 하나로 분류(트리아지)합니다. 워크스페이스별로 묶여 보이고, 프로젝트는 태그로 표시됩니다.
          </Row>
          <Row icon={<Sun size={15} />} name="Today (오늘)">
            <b>실행일이 오늘</b>인 태스크. 직접 만든 시간대 섹션(아침·오전 등)으로 나눠 드래그 배치할 수 있고,
            지난 날짜의 미완료 태스크는 “지연”으로 모입니다. 구글캘린더 일정도 함께 보입니다.
          </Row>
          <Row icon={<CalendarDays size={15} />} name="Scheduled (예정)">
            <b>실행일이 미래</b>인 태스크를 날짜별로. 구글캘린더 일정도 합쳐 보여줍니다.
          </Row>
          <Row icon={<Moon size={15} />} name="Someday (언젠가)">
            날짜를 정하지 않고 보류한 것. <b>날짜를 배정하는 순간 자동으로 활성화</b>되어 Today/Scheduled로 들어갑니다.
          </Row>
          <Row icon={<CalendarRange size={15} />} name="Calendar (캘린더)">
            월간/주간 달력(<Kbd>W</Kbd> 주간 · <Kbd>M</Kbd> 월간). 우측 Inbox 패널에서 태스크를 끌어 날짜에 놓으면 배정되고, 반대로 달력의 태스크를 패널로 끌면 Inbox로 되돌릴 수 있습니다.
            Someday 패널은 기본 숨김이며 필요할 때 펼칠 수 있습니다.
          </Row>
        </div>
        <p className="mt-3 rounded-md bg-zinc-100 px-3 py-2 text-[13.5px] dark:bg-zinc-800/60">
          <b>실행일 vs 마감일</b> — 날짜는 두 종류입니다. <b>실행일(Schedule)</b>은 “언제 할까”(Today/Scheduled를 결정),
          <b>마감일(Deadline)</b>은 “언제까지”(D-day 배지로 표시). 둘은 독립적입니다.
        </p>
      </Section>

      <Section title="칸반 ↔ GTD는 자동으로 연결됩니다">
        <p className="mb-2">프로젝트의 칸반 4컬럼은 별도 상태가 아니라 <b>태스크의 날짜·Someday에서 자동으로 파생</b>됩니다.
          그래서 한쪽에서 바꾸면 다른 쪽도 즉시 일치합니다. (태스크의 실제 상태값은 <b>시작전 / 완료</b> 둘뿐)</p>
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr className="border-b border-zinc-200 text-left text-zinc-400 dark:border-zinc-700">
              <th className="py-1.5 pr-3 font-semibold">칸반 컬럼</th>
              <th className="py-1.5 font-semibold">조건 (= GTD 상태)</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['백로그', 'Someday(언젠가)로 보류한 태스크'],
              ['시작전', '미완료 · 실행일 없음'],
              ['진행중', '미완료 · 실행일이 오늘 이하 (= Today/지연)'],
              ['완료', '완료된 태스크'],
            ].map(([c, d]) => (
              <tr key={c} className="border-b border-zinc-100 dark:border-zinc-800/70">
                <td className="py-1.5 pr-3 font-semibold">{c}</td>
                <td className="py-1.5 text-zinc-600 dark:text-zinc-300">{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[13.5px] text-zinc-500 dark:text-zinc-400">
          예: 칸반에서 태스크를 “진행중”으로 끌면 실행일이 오늘로 잡혀 Today에 나타나고, Inbox에서 Someday로 보내면 그 프로젝트 칸반의 백로그에 들어갑니다.
        </p>
      </Section>

      <Section title="워크스페이스 화면 (탭)">
        <p className="mb-2">워크스페이스는 <b>개요·Phase 보드·테이블·캘린더</b> 탭으로 전환합니다. <b>Phase 보드</b>만 프로젝트를 다루고, <b>테이블·캘린더</b>는 워크스페이스의 <b>모든 태스크</b>를 보여주되 <b>Phase·프로젝트(중첩, 기본)·상태·라벨</b>로 그룹화할 수 있습니다.</p>
        <ul className="ml-4 list-disc space-y-1.5">
          <li><PanelsTopLeft size={13} className="mb-0.5 mr-1 inline" /><b>개요</b> — Excalidraw 캔버스 + 노트로 자유 시각화.</li>
          <li><LayoutGrid size={13} className="mb-0.5 mr-1 inline" /><b>Phase 보드</b> — Phase별 프로젝트 카드. 카드를 끌어 Phase 간 이동/정렬, 누르면 프로젝트 화면으로.</li>
          <li><b>테이블</b> — 태스크 목록. Phase·프로젝트 중첩(기본)/상태/라벨로 그룹화, 행을 끌어 정렬·그룹 이동(프로젝트 그룹으로 옮기면 소속 프로젝트가 바뀜).</li>
        </ul>
        <p className="mt-2"><b>프로젝트 화면</b>도 동일하게 <b>테이블(기본)·보드·캘린더</b> 탭이며, 여기선 그 프로젝트의 <b>태스크</b>를 다룹니다(그룹화 상태/라벨, 필터 완료·상태·라벨).</p>
      </Section>

      <Section title="빠른 조작">
        <ul className="ml-4 list-disc space-y-1.5">
          <li><b>빠른 추가</b> — Inbox·Today·Someday 상단 입력칸, 또는 어디서든 <Kbd>Ctrl</Kbd>+<Kbd>K</Kbd>.
            “내일”, “금요일”, “6월 30일” 같은 한국어 날짜를 적으면 자동 인식됩니다.</li>
          <li><b>키보드만으로</b> — 아무것도 선택 안 한 상태에서 <Kbd>→</Kbd>를 누르면 상단 입력칸으로 이동, <Kbd>Enter</Kbd>로 작성합니다.
            입력칸에서 <Kbd>↓</Kbd>를 누르면 첫 태스크가 선택되고, <Kbd>↑</Kbd><Kbd>↓</Kbd>로 태스크를 옮겨다닐 수 있습니다.</li>
          <li><b>태스크에 마우스를 올리면</b> 5개 버튼이 나타납니다 — Today · Schedule(실행일) · Someday · 프로젝트 · Deadline(마감일).</li>
          <li><b>방향키 선택</b> — 워크스페이스·프로젝트의 보드/테이블에서도 <Kbd>↑</Kbd><Kbd>↓</Kbd>로 프로젝트·태스크를 선택하고 <Kbd>Enter</Kbd>로 엽니다(프로젝트는 진입, 태스크는 상세).</li>
          <li><b>드래그앤드롭</b> — Inbox 드롭존, 칸반·캘린더에 더해 <b>보드 카드·테이블 행</b>도 끌어 정렬하고, 다른 Phase·상태·그룹으로 옮기면 값이 바뀝니다.</li>
          <li><b>실행취소</b> — <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd>로 태스크 변경을 되돌립니다.</li>
        </ul>
      </Section>

      <Section title="단축키">
        <div className="space-y-0.5">
          {SHORTCUTS.map(s => (
            <div key={s.keys + s.desc} className="flex items-center justify-between gap-3 rounded px-1 py-0.5 text-[13.5px]">
              <span className="text-zinc-600 dark:text-zinc-300">{s.desc}</span>
              <span className="shrink-0 font-mono text-[12.5px] text-zinc-500 dark:text-zinc-400">{s.keys}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[12.5px] text-zinc-400">어디서든 <Kbd>?</Kbd>로 이 목록을 띄울 수 있습니다.</p>
      </Section>

      <Section title="구글캘린더 연동">
        <p className="text-[13.5px]">설정 화면에서 “연결”을 누르면 Today·Scheduled·Calendar에 오늘/예정 일정이 함께 표시됩니다.
          표시할 캘린더는 설정에서 체크박스로 고를 수 있습니다.</p>
      </Section>

      <Section title="백업">
        <p className="text-[13.5px]">설정 → 백업에서 전체 데이터를 JSON으로 내보낼 수 있습니다. 주기적으로 받아두는 것을 권장합니다.</p>
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 border-b border-zinc-200 pb-1 text-[15px] font-bold dark:border-zinc-800">{title}</h2>
      <div className="text-[14px] leading-relaxed text-zinc-700 dark:text-zinc-300">{children}</div>
    </section>
  )
}

function Row({ icon, name, children }: { icon: React.ReactNode; name: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5 rounded-lg border border-zinc-200 p-2.5 dark:border-zinc-800">
      <span className="mt-0.5 shrink-0 text-zinc-400">{icon}</span>
      <div>
        <div className="text-[14px] font-bold">{name}</div>
        <p className="text-[13.5px] text-zinc-600 dark:text-zinc-400">{children}</p>
      </div>
    </div>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-zinc-300 bg-zinc-50 px-1 text-[12px] font-semibold text-zinc-500 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{children}</kbd>
}
