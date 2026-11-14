import { router } from 'expo-router';
import { formatMonthYear, formatWeekdayDate } from '@clarity/shared';
import { backupDue } from '@clarity/data';
import { HomeView } from '../../src/features/Home';
import { setAddPrefill, setExplain } from '../../src/state/nav';
import { useData, useSession, useStore } from '../../src/state/session';
import { Screen } from '../../src/ui/Screen';

export default function Home() {
  const data = useData();
  const { today } = useSession();
  const { demo } = useStore();
  const backup = demo ? { due: false, reason: null } : backupDue(data, Date.now());
  return (
    <Screen title={formatMonthYear(today).split(' ')[0]} subtitle={formatWeekdayDate(today)}>
      <HomeView
        data={data}
        today={today}
        backup={backup}
        actions={{
          explain: (ex) => { setExplain(ex); router.push('/explain'); },
          open: (path) => router.push(path),
          add: (p) => { setAddPrefill(p); router.push('/add'); },
        }}
      />
    </Screen>
  );
}
