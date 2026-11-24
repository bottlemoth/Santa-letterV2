import { api } from '../api.js';
import { h, icon } from '../dom.js';
import { pageHeader, emptyState, formatDateTime, toast } from '../ui.js';
import { state } from '../state.js';

const TYPE_ICONS = {
  group_joined: 'users',
  group_welcome: 'users',
  group_removed: 'users',
  group_ownership: 'star',
  group_deleted: 'users',
  list_published: 'gift',
  list_deleted: 'trash',
  upcoming_occasion: 'calendar',
  reserved_item_removed: 'gift',
};

export async function notificationsView() {
  const { notifications, unreadCount } = await api.get('/notifications');
  state.unread = unreadCount;
  state.refreshUnread();
  const rerender = () => state.navigate('/notifications');

  const markAll = unreadCount ? h('button', { type: 'button', class: 'btn btn-ghost' }, icon('check'), ' Oznacz wszystkie jako przeczytane') : null;
  markAll?.addEventListener('click', async () => {
    try {
      await api.post('/notifications/read-all');
      toast('Wszystkie powiadomienia oznaczono jako przeczytane.');
      rerender();
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  const row = (n) => {
    const markBtn = n.read ? null : h('button', { type: 'button', class: 'btn btn-sm btn-ghost' }, 'Oznacz jako przeczytane');
    markBtn?.addEventListener('click', async () => {
      try {
        await api.post(`/notifications/${n.id}/read`);
        rerender();
      } catch (err) {
        toast(err.message, 'error');
      }
    });
    return h(
      'li',
      { class: `notification ${n.read ? 'read' : 'unread'}` },
      h('span', { class: 'notif-icon' }, icon(TYPE_ICONS[n.type] || 'bell')),
      h(
        'div',
        { class: 'notif-body' },
        n.read ? null : h('span', { class: 'visually-hidden' }, 'Nieprzeczytane: '),
        n.link ? h('a', { href: `#${n.link}` }, n.message) : h('p', {}, n.message),
        h('time', { class: 'meta', datetime: n.createdAt }, formatDateTime(n.createdAt)),
      ),
      markBtn,
    );
  };

  return h(
    'div',
    { class: 'narrow' },
    pageHeader('Powiadomienia', {
      subtitle: unreadCount ? `Nieprzeczytane: ${unreadCount}` : 'Wszystko przeczytane.',
      actions: markAll,
    }),
    notifications.length
      ? h('ul', { class: 'notifications card' }, notifications.map(row))
      : emptyState({ iconName: 'bell', title: 'Cisza jak w Wigilię o północy', text: 'Nie masz jeszcze żadnych powiadomień.' }),
  );
}
