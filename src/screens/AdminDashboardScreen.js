import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, FlatList, Alert, Linking, ActivityIndicator, useWindowDimensions, Modal } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { COLORS, SIZES } from '../constants/theme';
import { getSecurely, saveSecurely } from '../services/StorageService';
import { logAdminAction } from '../services/AuditService';
import { changeLanguage } from '../services/i18n';
import { registerUser, listenToOrders, assignOrderDriverAsync, updateOrderStatusAsync } from '../services/FirebaseService';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext';
import ProductTimer from '../components/ProductTimer';

const AdminDashboardScreen = () => {
  const { t, i18n } = useTranslation();
  const { logout, userRole } = useAuth();
  const { width } = useWindowDimensions();
  const isMobile = width < 480;
  const isRTL = i18n.language === 'ar';
  
  const languages = [
    { code: 'fr', label: 'FR' },
    { code: 'ar', label: 'AR' },
    { code: 'en', label: 'EN' },
  ];

  // Tabs: inventory, orders, finance, users, archive
  const [activeTab, setActiveTab] = useState('inventory');
  const [role, setRole] = useState(userRole || 'admin'); // owner, admin, driver
  const [isLoading, setIsLoading] = useState(true);

  // --- Real-time State ---
  const [inventory, setInventory] = useState([]);
  const [orders, setOrders] = useState([]);
  const [isAddModalVisible, setIsAddModalVisible] = useState(false);
  const [newItem, setNewItem] = useState({ 
    name_ar: '', 
    name_fr: '', 
    name_en: '', 
    category: '1', 
    price: '', 
    discount: '0', 
    unit: 'piece',
    unitValue: '',
    saleDuration: '30', // Default 30 minutes
    image: '' 
  });
  const [inventoryCatFilter, setInventoryCatFilter] = useState('all');
  const [editingValues, setEditingValues] = useState({}); // { [id]: { price: '...', discount: '...' } }

  // Users Management State
  const [newUserUsername, setNewUserUsername] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPhone, setNewUserPhone] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserMfaCode, setNewUserMfaCode] = useState('159753'); // Default for new users
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState('admin');
  const [usersList, setUsersList] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Edit User State
  const [editingUser, setEditingUser] = useState(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editRole, setEditRole] = useState('');
  const [editPassword, setEditPassword] = useState('');
  const [editMfaCode, setEditMfaCode] = useState('');

  const categoryMap = [
    { id: 'all', label: t('all_categories'), icon: 'view-grid' },
    { id: '1', label: t('vegetables'), icon: 'carrot' },
    { id: '2', label: t('clothing'), icon: 'tshirt-crew' },
    { id: '3', label: t('groceries'), icon: 'basket' },
    { id: '4', label: t('local_crafts'), icon: 'palette' },
    { id: '5', label: t('makeup'), icon: 'lipstick' },
    { id: '6', label: t('cleaning'), icon: 'spray' },
    { id: '7', label: t('bio'), icon: 'leaf' },
    { id: '8', label: t('home_diy'), icon: 'home-variant' },
    { id: '9', label: t('ready_food'), icon: 'food-variant' },
  ];

  const loadInventory = async () => {
    const data = await getSecurely('products_v1');
    if (data) setInventory(JSON.parse(data));
  };

  const saveInventory = async (newInv) => {
    try {
      setInventory(newInv);
      const success = await saveSecurely('products_v1', JSON.stringify(newInv));
      if (!success) {
         console.warn("Storage write failed, may exceed limits or web quota");
         // We still keep the state update so the user sees it in session
      }
    } catch (e) {
      console.error("saveInventory Error:", e);
    }
  };

  const loadUsers = async () => {
    const data = await getSecurely('app_users');
    if (data) setUsersList(JSON.parse(data));
  };

  const deleteUser = async (userId) => {
    const updated = usersList.filter(u => u.id !== userId);
    setUsersList(updated);
    await saveSecurely('app_users', JSON.stringify(updated));
    await handleAdminAction('DELETE_USER', { userId });
    Alert.alert(t('success'), t('user_deleted') || 'User deleted');
  };

  const startEditUser = (user) => {
    setEditingUser(user);
    setEditName(user.name);
    setEditEmail(user.email || '');
    setEditPhone(user.phone || '');
    setEditRole(user.role);
    setEditPassword(''); 
    setEditMfaCode(user.mfaCode || '159753');
  };

  const handleUpdateUser = async () => {
    if (!editName) return Alert.alert(t('error'), t('fill_fields'));
    
    const updated = usersList.map(u => u.id === editingUser.id ? {
      ...u,
      name: editName,
      email: editEmail,
      phone: editPhone,
      role: editRole,
      password: editPassword ? editPassword : u.password,
      mfaCode: editMfaCode || u.mfaCode || '159753'
    } : u);
    
    setUsersList(updated);
    await saveSecurely('app_users', JSON.stringify(updated));
    await handleAdminAction('EDIT_USER', { userId: editingUser.id, name: editName });
    Alert.alert(t('success'), t('update_success') || 'Updated ✓');
    setEditingUser(null);
  };

  useEffect(() => {
    // Force French as default for Admin Dashboard
    changeLanguage('fr');

    const fetchRole = async () => {
      const storedRole = await getSecurely('userRole');
      if (storedRole) setRole(storedRole);
    };
    fetchRole();
    loadInventory();
    loadUsers();

    const unsubscribeOrders = listenToOrders(setOrders);
    setTimeout(() => setIsLoading(false), 800);
    return () => {
      if (unsubscribeOrders) unsubscribeOrders();
    };
  }, []);

  // --- Handlers ---
  const handleAdminAction = async (action, details) => {
    if (role !== 'owner' && role !== 'admin') return Alert.alert(t('access_denied'), t('drivers_cannot_manage'));
    await logAdminAction('admin_001', action, details);
  };

  const handleLogout = async () => {
    await logout();
  };

  const addInventoryItem = async () => {
    if (!newItem.name_fr || !newItem.price) return Alert.alert(t('error'), t('fill_fields'));
    
    try {
      const currencySuffix = t('currency') || 'MAD';
      let cleanPrice = String(newItem.price).replace(/[^\d.]/g, '');
      const formattedPrice = `${cleanPrice} ${currencySuffix}`;

      let discVal = parseInt(newItem.discount) || 0;
      let durationHours = parseFloat(newItem.saleDuration) || 0;
      let finalDiscount = discVal > 0 ? `${discVal}%` : '';

      const itemToAdd = {
        id: 'p' + Date.now(),
        name: newItem.name_fr, // Legacy support
        names: {
          ar: newItem.name_ar || newItem.name_fr,
          fr: newItem.name_fr,
          en: newItem.name_en || newItem.name_fr
        },
        unit: newItem.unitValue ? `${newItem.unitValue} ${t(newItem.unit)}` : newItem.unit,
        price: formattedPrice,
        discount: finalDiscount,
        oldPrice: discVal > 0 ? formattedPrice : null, 
        saleEndsAt: (discVal > 0 && durationHours > 0) ? (Date.now() + durationHours * 60000) : null,
        image: newItem.image || 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=400',
        vendor: 'Admin',
        stock: 100,
        sold: 0,
        category: newItem.category || '1'
      };

      // If discounted, calculate the new price
      if (discVal > 0) {
        const salePrice = (parseFloat(cleanPrice) * (1 - discVal / 100)).toFixed(2);
        itemToAdd.price = `${salePrice} ${currencySuffix}`;
        itemToAdd.oldPrice = formattedPrice;
      }

      const newInv = [itemToAdd, ...inventory];
      await saveInventory(newInv);
      
      handleAdminAction('ADD_PRODUCT', { name: newItem.name_fr, category: newItem.category }).catch(err => {});

      setNewItem({ name_ar: '', name_fr: '', name_en: '', category: '1', price: '', discount: '0', unit: 'piece', unitValue: '', saleDuration: '30', image: '' });
      setIsAddModalVisible(false);
      Alert.alert(t('success'), t('add_product') + ' ✓');
    } catch (err) {
      console.error("Add Product Crash:", err);
      Alert.alert(t('error'), "Failed to add product: " + err.message);
    }
  };

  const deleteInventoryItem = async (id) => {
    const newInv = inventory.filter(i => i.id !== id);
    await saveInventory(newInv);
    await handleAdminAction('DELETE_PRODUCT', { id });
  };

  const applyInventoryEdits = async (id) => {
    const edits = editingValues[id];
    if (!edits) return;

    const newInv = inventory.map(i => {
      if (i.id === id) {
        let updated = { ...i };
        const currencySuffix = t('currency') || 'MAD';
        
        let basePriceRaw = edits.price ? edits.price : 
                           (i.oldPrice ? String(i.oldPrice).replace(/[^\d.]/g, '') : String(i.price).replace(/[^\d.]/g, ''));
        let basePriceStr = `${basePriceRaw} ${currencySuffix}`;
        
        let discountPercent = edits.discount !== undefined ? (parseInt(edits.discount) || 0) : 
                              (i.discount ? parseInt(String(i.discount).replace('%', '')) : 0);

        if (discountPercent > 0) {
           const salePrice = (parseFloat(basePriceRaw) * (1 - discountPercent / 100)).toFixed(2);
           updated.price = `${salePrice} ${currencySuffix}`;
           updated.oldPrice = basePriceStr;
           updated.discount = `${discountPercent}%`;
           
           if (edits.saleDuration !== undefined) {
              const minutes = parseFloat(edits.saleDuration) || 30;
              updated.saleEndsAt = Date.now() + minutes * 60000;
           } else if (!i.saleEndsAt) { 
              updated.saleEndsAt = Date.now() + 30 * 60000;
           }
        } else {
           updated.price = basePriceStr;
           updated.oldPrice = null;
           updated.discount = '';
           updated.saleEndsAt = null;
        }

        return updated;
      }
      return i;
    });
    
    await saveInventory(newInv);
    await handleAdminAction('UPDATE_PRODUCT_FEILDS', { id, edits });
    setEditingValues(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    Alert.alert(t('success'), t('update_success') || 'Updated ✓');
  };

  const adjustStock = async (id, delta) => {
    const newInv = inventory.map(i => {
      if (i.id === id) {
        const currentStock = i.stock !== undefined ? i.stock : 100;
        const newStock = Math.max(0, currentStock + delta);
        return { ...i, stock: newStock };
      }
      return i;
    });
    await saveInventory(newInv);
  };

  const setStockDirect = async (id, value) => {
    const num = parseInt(value) || 0;
    const newInv = inventory.map(i => i.id === id ? { ...i, stock: Math.max(0, num) } : i);
    await saveInventory(newInv);
  };

  const openGPS = (lat, lng) => {
    const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
    Linking.openURL(url);
  };

  const resetStock = async (id) => {
    if (role !== 'owner') return Alert.alert(t('access_denied'), t('only_owner_reset'));
    const newInv = inventory.map(i => i.id === id ? { ...i, stock: 100, sold: 0 } : i);
    await saveInventory(newInv);
    Alert.alert(t('success'), t('stock_reset_success'));
  };

  const assignDriver = async (orderId) => {
    try {
      await assignOrderDriverAsync(orderId, 'Express Driver A', 'd2');
      handleAdminAction('DRIVER_ASSIGN', { orderId, driver: 'Express Driver A' });
      Alert.alert(t('assigned'), t('order_assigned_success'));
    } catch (e) {
      Alert.alert(t('assign_failed'), e.message);
    }
  };

  const updateOrderStatus = async (orderId, newStatus) => {
    try {
      await updateOrderStatusAsync(orderId, newStatus);
      Alert.alert(t('success'), `${t('orders')} → ${newStatus}`);
    } catch (e) {
      Alert.alert(t('error'), e.message);
    }
  };

  const handleAddUser = async () => {
    if (!newUserUsername || !newUserPassword || !newUserName) {
      return Alert.alert(t('error'), t('fill_fields'));
    }
    try {
      const existing = usersList.find(u => u.username && u.username.toLowerCase() === newUserUsername.trim().toLowerCase());
      if (existing) return Alert.alert(t('error'), t('user_already_exists'));

      const newUser = {
        id: 'user_' + Date.now(),
        name: newUserName.trim(),
        username: newUserUsername.trim().toLowerCase(),
        email: newUserEmail.trim().toLowerCase(),
        phone: newUserPhone.trim(),
        password: newUserPassword,
        mfaCode: newUserMfaCode.trim() || '159753',
        role: newUserRole,
        createdAt: new Date().toISOString()
      };
      const updated = [...usersList, newUser];
      setUsersList(updated);
      await saveSecurely('app_users', JSON.stringify(updated));
      await handleAdminAction('ADD_USER', { username: newUserUsername, role: newUserRole });
      Alert.alert(t('success'), t('user_added_success'));
      setNewUserUsername('');
      setNewUserEmail('');
      setNewUserPhone('');
      setNewUserPassword('');
      setNewUserName('');
      setNewUserRole('admin');
    } catch (e) {
      Alert.alert(t('error'), e.message);
    }
  };

  // --- Filtered Views for RBAC ---
  const isAdmin = role === 'owner' || role === 'admin';
  const filteredOrders = isAdmin ? orders : orders.filter(o => o.driverId === 'd1');
  const completedOrders = orders.filter(o => o.status === 'Completed');

  // Inventory filtered by search and category
  const filteredInventory = inventory.filter(i => {
    const productName = i.names ? (i.names[i18n.language] || i.names['fr'] || '') : (i.name || '');
    const matchesSearch = productName.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCat = inventoryCatFilter === 'all' || i.category === inventoryCatFilter;
    return matchesSearch && matchesCat;
  });

  // --- Render Functions ---

  const renderCategoryFilter = () => (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }} contentContainerStyle={{ flexDirection: isRTL ? 'row-reverse' : 'row' }}>
      {categoryMap.map(cat => (
        <TouchableOpacity
          key={cat.id}
          style={[styles.catFilterBtn, inventoryCatFilter === cat.id && styles.catFilterBtnActive]}
          onPress={() => setInventoryCatFilter(cat.id)}
        >
          <MaterialCommunityIcons name={cat.icon} size={16} color={inventoryCatFilter === cat.id ? COLORS.white : COLORS.textGray} />
          <Text style={[styles.catFilterText, inventoryCatFilter === cat.id && styles.catFilterTextActive]}>{cat.label}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );

  const renderInventory = () => (
    <View style={styles.tabContent}>
      <View style={{ marginBottom: 15, flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', backgroundColor: '#F5F5F5', borderRadius: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
        <MaterialCommunityIcons name="magnify" size={24} color={COLORS.primary} />
        <TextInput 
          style={{ flex: 1, height: 45, paddingHorizontal: 10, textAlign: isRTL ? 'right' : 'left', fontSize: 16 }}
          placeholder={t('search_product') || 'Search...'}
          value={searchQuery}
          onChangeText={setSearchQuery}
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => setSearchQuery('')}>
            <MaterialCommunityIcons name="close-circle" size={20} color={COLORS.textGray} />
          </TouchableOpacity>
        )}
      </View>

      <View style={{ flexDirection: isRTL ? 'row-reverse' : 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
        <Text style={[styles.tabTitle, { marginBottom: 0 }]}>{t('inventory_management')}</Text>
        {isAdmin && (
          <TouchableOpacity style={[styles.addBtn, { paddingVertical: 8, paddingHorizontal: 15 }]} onPress={() => setIsAddModalVisible(true)}>
            <MaterialCommunityIcons name="plus-circle" size={20} color="#FFF" />
            <Text style={[styles.addBtnText, { marginLeft: 5 }]}>{t('add_product')}</Text>
          </TouchableOpacity>
        )}
      </View>
      
      {renderCategoryFilter()}
      {/* Add Product Modal */}
      <Modal visible={isAddModalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView contentContainerStyle={styles.modalScroll}>
            <View style={styles.modalCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 20 }}>
                <Text style={styles.modalTitle}>{t('add_new_product_title')}</Text>
                <TouchableOpacity onPress={() => setIsAddModalVisible(false)}>
                  <MaterialCommunityIcons name="close" size={24} color="#666" />
                </TouchableOpacity>
              </View>

              <Text style={styles.inputLabel}>{t('name_fr')}</Text>
              <TextInput style={styles.input} value={newItem.name_fr} onChangeText={t => setNewItem({...newItem, name_fr: t})} placeholder="Nom du produit..." />
              
              <Text style={styles.inputLabel}>{t('name_ar')}</Text>
              <TextInput style={[styles.input, { textAlign: 'right' }]} value={newItem.name_ar} onChangeText={t => setNewItem({...newItem, name_ar: t})} placeholder="اسم المنتج..." />
              
              <Text style={styles.inputLabel}>{t('name_en')}</Text>
              <TextInput style={styles.input} value={newItem.name_en} onChangeText={t => setNewItem({...newItem, name_en: t})} placeholder="Product name..." />

              <View style={{ flexDirection: 'row', gap: 15, marginBottom: 15 }}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>{t('price')} (MAD)</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={newItem.price} onChangeText={t => setNewItem({...newItem, price: t})} placeholder="0.00" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.inputLabel}>{t('discount')} (%)</Text>
                  <TextInput style={styles.input} keyboardType="numeric" value={newItem.discount} onChangeText={t => setNewItem({...newItem, discount: t})} placeholder="0" />
                </View>
              </View>

              {parseInt(newItem.discount) > 0 && (
                 <View style={{ marginBottom: 15 }}>
                   <Text style={styles.inputLabel}>{t('sale_duration_mins')}</Text>
                   <TextInput style={styles.input} keyboardType="numeric" value={newItem.saleDuration} onChangeText={t => setNewItem({...newItem, saleDuration: t})} placeholder="30" />
                 </View>
              )}

              <Text style={styles.inputLabel}>{t('unit')}</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
                {['piece', 'kg', 'litre', 'other'].map(u => (
                  <TouchableOpacity 
                    key={u} 
                    style={[styles.unitBtn, newItem.unit === u && styles.unitBtnActive]} 
                    onPress={() => setNewItem({...newItem, unit: u})}
                  >
                    <Text style={[styles.unitText, newItem.unit === u && styles.unitTextActive]}>{t(u)}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {newItem.unit && (
                <View style={{ marginBottom: 20 }}>
                  <Text style={styles.inputLabel}>{t('unit_value')}</Text>
                  <TextInput 
                    style={styles.input} 
                    value={newItem.unitValue} 
                    onChangeText={t => setNewItem({...newItem, unitValue: t})} 
                    placeholder={newItem.unit === 'other' ? "Nom de l'unité..." : "1, 500, 2.5..."}
                  />
                </View>
              )}

              <Text style={styles.inputLabel}>{t('category')}</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }}>
                {categoryMap.filter(c => c.id !== 'all').map(cat => (
                  <TouchableOpacity key={cat.id} style={[styles.catFilterBtn, newItem.category === cat.id && styles.catFilterBtnActive]} onPress={() => setNewItem({...newItem, category: cat.id})}>
                    <Text style={[styles.catFilterText, newItem.category === cat.id && styles.catFilterTextActive]}>{cat.label}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <Text style={styles.inputLabel}>{t('image_url')} <Text style={{ fontSize: 10, color: COLORS.textGray }}>{t('image_size_hint')}</Text></Text>
              <TextInput style={styles.input} value={newItem.image} onChangeText={t => setNewItem({...newItem, image: t})} placeholder="https://..." />

              <TouchableOpacity style={styles.saveBtn} onPress={addInventoryItem}>
                <Text style={styles.saveBtnText}>{t('add_product')}</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </Modal>

      <FlatList
        data={filteredInventory}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <View style={[styles.listItem, isMobile && { flexDirection: 'column', alignItems: 'stretch' }]}>
            <View style={{ flex: 1, marginBottom: isMobile ? 12 : 0 }}>
              <Text style={[styles.itemName, { textAlign: isRTL ? 'right' : 'left' }]}>
                {item.names ? (item.names[i18n.language] || item.names['fr']) : (t(item.name) || item.name)}
              </Text>
              <Text style={[styles.itemSub, { textAlign: isRTL ? 'right' : 'left' }]}>
                {categoryMap.find(c => c.id === item.category)?.label || item.category} • {item.price} {item.oldPrice ? `(${t('was')} ${item.oldPrice})` : ''} 
                {item.unit ? ` • ${t(item.unit)}` : ''}
              </Text>
              {item.discount && <Text style={{ fontSize: 10, color: '#E53935', fontWeight: 'bold', textAlign: isRTL ? 'right' : 'left' }}>{t('sale')}: {item.discount}</Text>}
              <Text style={{fontSize: 12, color: COLORS.primary, fontWeight: 'bold', textAlign: isRTL ? 'right' : 'left', marginTop: 4}}>
                 {t('stock_remaining')}: {item.stock !== undefined ? item.stock : 100} | {t('sold')}: {item.sold || 0}
              </Text>
              {item.saleEndsAt && (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                  <ProductTimer endsAt={item.saleEndsAt} onExpire={loadInventory} />
                </View>
              )}
            </View>
            
            <View style={[styles.itemControlRow, isMobile && { flexDirection: 'column', alignItems: 'stretch', borderTopWidth: 1, borderTopColor: '#F0F0F0', paddingTop: 10 }]}>
              {/* Stock Controls: - [input] + */}
              <View style={{ alignItems: 'center', marginRight: isMobile ? 0 : 10, marginBottom: isMobile ? 10 : 0 }}>
                <Text style={styles.controlLabel}>{t('stock')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                  <TouchableOpacity onPress={() => adjustStock(item.id, -1)} style={styles.stockBtn}>
                    <MaterialCommunityIcons name="minus" size={16} color="#E53935" />
                  </TouchableOpacity>
                  <TextInput
                    style={[styles.smallInput, { width: 50, textAlign: 'center' }]}
                    keyboardType="numeric"
                    value={String(item.stock !== undefined ? item.stock : 100)}
                    onChangeText={(val) => setStockDirect(item.id, val)}
                  />
                  <TouchableOpacity onPress={() => adjustStock(item.id, 1)} style={styles.stockBtn}>
                    <MaterialCommunityIcons name="plus" size={16} color="#4CAF50" />
                  </TouchableOpacity>
                  {role === 'owner' && (
                    <TouchableOpacity onPress={() => resetStock(item.id)} style={{ marginLeft: 4 }}>
                      <MaterialCommunityIcons name="restore" size={20} color="#FF9800" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>

              {/* Price & Discount Controls */}
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, flexWrap: 'wrap' }}>
                <View style={{ alignItems: 'center' }}>
                  <Text style={styles.controlLabel}>{t('price')}</Text>
                  <TextInput 
                    style={styles.smallInput} 
                    placeholder="MAD" 
                    keyboardType="numeric"
                    value={editingValues[item.id]?.price}
                    onChangeText={(val) => setEditingValues(prev => ({ ...prev, [item.id]: { ...prev[item.id], price: val } }))}
                  />
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={styles.controlLabel}>{t('discount_label')}</Text>
                  <TextInput 
                    style={styles.smallInput} 
                    placeholder="%" 
                    keyboardType="numeric"
                    value={editingValues[item.id]?.discount}
                    onChangeText={(val) => setEditingValues(prev => ({ ...prev, [item.id]: { ...prev[item.id], discount: val } }))}
                  />
                </View>
                {editingValues[item.id]?.discount > 0 && (
                  <View style={{ alignItems: 'center' }}>
                    <Text style={styles.controlLabel}>{t('minutes')}</Text>
                    <TextInput 
                      style={[styles.smallInput, { width: 40 }]} 
                      placeholder="30" 
                      keyboardType="numeric"
                      value={editingValues[item.id]?.saleDuration || '30'}
                      onChangeText={(val) => setEditingValues(prev => ({ ...prev, [item.id]: { ...prev[item.id], saleDuration: val } }))}
                    />
                  </View>
                )}
                {(editingValues[item.id]?.price || editingValues[item.id]?.discount !== undefined) && (
                  <TouchableOpacity onPress={() => applyInventoryEdits(item.id)} style={{ padding: 4, marginBottom: 2 }}>
                    <MaterialCommunityIcons name="check-circle" size={24} color={COLORS.primary} />
                  </TouchableOpacity>
                )}
              </View>

              <TouchableOpacity onPress={() => deleteInventoryItem(item.id)} style={{ marginLeft: 8, alignSelf: 'center' }}>
                <MaterialCommunityIcons name="delete-outline" size={22} color="#F44336" />
              </TouchableOpacity>
            </View>
          </View>
        )}
      />
    </View>
  );

  const renderFinancials = () => {
    const revenueTotal = orders
      .filter(o => o.status === 'Completed')
      .reduce((sum, o) => {
        const parsed = parseFloat(String(o.total || 0).replace(/[^\d.]/g, '')) || 0;
        return sum + parsed;
      }, 0);

    return (
      <View style={styles.tabContent}>
        <Text style={[styles.tabTitle, { textAlign: isRTL ? 'right' : 'left' }]}>{t('finance')}</Text>
        <View style={[styles.financeCard, isMobile && { flexDirection: 'column' }]}>
           <View style={isMobile && { marginBottom: 20 }}>
             <Text style={styles.financeLabel}>{t('total_revenue')}</Text>
             <Text style={styles.financeValue}>{revenueTotal} {t('currency') || 'MAD'}</Text>
           </View>
           <View>
             <Text style={styles.financeLabel}>{t('orders_completed')}</Text>
             <Text style={styles.financeValue}>{orders.filter(o => o.status === 'Completed').length}</Text>
           </View>
        </View>
        <Text style={[styles.tabSubText, { textAlign: isRTL ? 'right' : 'left' }]}>{t('revenue_note')}</Text>
      </View>
    );
  };

  const renderOrders = () => (
    <View style={styles.tabContent}>
      <Text style={[styles.tabTitle, { textAlign: isRTL ? 'right' : 'left' }]}>{role === 'owner' ? t('all_orders') : (role === 'admin' ? t('admin_orders') : t('my_deliveries'))}</Text>
      {filteredOrders.length === 0 ? (
        <Text style={[styles.restrictedText, { color: COLORS.textGray }]}>{t('no_completed_orders')}</Text>
      ) : null}
      {filteredOrders.map(order => (
        <View key={order.id} style={styles.orderCard}>
          <View style={[styles.orderHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            <Text style={styles.orderId}>{t('order_id')} #{order.id}</Text>
            <View style={[styles.statusBadge, { backgroundColor: order.status === 'Pending' ? '#FFE0B2' : '#E8F5E9' }]}>
              <Text style={{ fontSize: 10, color: order.status === 'Pending' ? '#F57C00' : '#2E7D32' }}>{order.status}</Text>
            </View>
          </View>
          <Text style={styles.customerName}>{order.customer}</Text>
          {role === 'owner' && <Text style={styles.driverName}>{t('driver')}: {order.driver}</Text>}
          <View style={styles.orderActions}>
            <TouchableOpacity style={styles.gpsBtn} onPress={() => openGPS(order.location?.lat, order.location?.lng)}>
              <MaterialCommunityIcons name="google-maps" size={18} color={COLORS.white} />
              <Text style={styles.gpsText}>{t('gps_view')}</Text>
            </TouchableOpacity>
            {role === 'owner' && order.status === 'Pending' && (
              <TouchableOpacity style={styles.assignBtn} onPress={() => assignDriver(order.id)}>
                <Text style={styles.assignText}>{t('assign_driver')}</Text>
              </TouchableOpacity>
            )}
            
            {role === 'driver' && order.status === 'Out for Delivery' && (
              <TouchableOpacity style={[styles.assignBtn, { backgroundColor: '#34A853' }]} onPress={() => updateOrderStatus(order.id, 'Completed')}>
                 <Text style={styles.assignText}>{t('mark_completed')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ))}
    </View>
  );

  const renderUsers = () => (
    <View style={styles.tabContent}>
      <Text style={[styles.tabTitle, { textAlign: isRTL ? 'right' : 'left' }]}>{t('users_management')}</Text>
      
      {/* Add User Form */}
      <View style={styles.addCard}>
        <Text style={[styles.sectionLabel, { textAlign: isRTL ? 'right' : 'left', marginBottom: 12 }]}>{t('add_user')}</Text>
        <TextInput style={[styles.input, { textAlign: isRTL ? 'right' : 'left' }]} placeholder={t('buyer_name')} value={newUserName} onChangeText={setNewUserName}/>
        <TextInput style={[styles.input, { textAlign: isRTL ? 'right' : 'left' }]} placeholder={t('username')} value={newUserUsername} onChangeText={setNewUserUsername} autoCapitalize="none"/>
        <TextInput style={[styles.input, { textAlign: isRTL ? 'right' : 'left' }]} placeholder={t('email')} value={newUserEmail} onChangeText={setNewUserEmail} keyboardType="email-address" autoCapitalize="none"/>
        <TextInput style={[styles.input, { textAlign: isRTL ? 'right' : 'left' }]} placeholder={t('phone')} value={newUserPhone} onChangeText={setNewUserPhone} keyboardType="phone-pad"/>
        <TextInput style={[styles.input, { textAlign: isRTL ? 'right' : 'left' }]} placeholder={t('password')} value={newUserPassword} onChangeText={setNewUserPassword} secureTextEntry/>
        <TextInput style={[styles.input, { textAlign: isRTL ? 'right' : 'left' }]} placeholder={t('mfa_code') || 'MFA Code'} value={newUserMfaCode} onChangeText={setNewUserMfaCode} keyboardType="numeric"/>
        
        <Text style={[styles.sectionLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t('select_role')}</Text>
        <View style={[styles.row, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
          <TouchableOpacity style={[styles.categoryBtn, newUserRole === 'admin' && styles.activeCat]} onPress={() => setNewUserRole('admin')}>
            <MaterialCommunityIcons name="shield-account" size={16} color={newUserRole === 'admin' ? '#FFF' : COLORS.textGray} />
            <Text style={[{ marginLeft: 4 }, newUserRole === 'admin' ? styles.activeCatText : {}]}>{t('admin')}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.categoryBtn, newUserRole === 'driver' && styles.activeCat]} onPress={() => setNewUserRole('driver')}>
            <MaterialCommunityIcons name="truck-delivery" size={16} color={newUserRole === 'driver' ? '#FFF' : COLORS.textGray} />
            <Text style={[{ marginLeft: 4 }, newUserRole === 'driver' ? styles.activeCatText : {}]}>{t('driver')}</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={handleAddUser}>
          <MaterialCommunityIcons name="account-plus" size={20} color="#FFF" />
          <Text style={[styles.addBtnText, { marginLeft: 8 }]}>{t('add_user')}</Text>
        </TouchableOpacity>
      </View>

      {/* Users List */}
      <Text style={[styles.sectionLabel, { textAlign: isRTL ? 'right' : 'left', marginBottom: 10, marginTop: 5 }]}>
        {t('users_management')} ({usersList.length})
      </Text>
      {usersList.length === 0 ? (
        <Text style={[styles.restrictedText, { color: COLORS.textGray, fontStyle: 'italic' }]}>{t('no_users_yet')}</Text>
      ) : usersList.map(user => (
        <View key={user.id} style={styles.userCard}>
          <View style={[{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', flex: 1 }]}>
            <View style={[styles.userAvatar, { backgroundColor: user.role === 'admin' ? COLORS.primary : (user.role === 'driver' ? '#FF9800' : '#9E9E9E') }]}>
              <MaterialCommunityIcons
                name={user.role === 'admin' ? 'shield-account' : (user.role === 'driver' ? 'truck-delivery' : 'account')}
                size={22} color="#FFF"
              />
            </View>
            <View style={[{ flex: 1 }, isRTL ? { marginRight: 12 } : { marginLeft: 12 }]}>
              <Text style={[styles.userName, { textAlign: isRTL ? 'right' : 'left' }]}>{user.name}</Text>
              <Text style={[styles.userEmail, { textAlign: isRTL ? 'right' : 'left' }]}>@{user.username} {user.phone ? `• ${user.phone}` : ''}</Text>
              {user.email ? <Text style={[styles.userEmail, { fontSize: 11, marginTop: 2, textAlign: isRTL ? 'right' : 'left' }]}>{user.email}</Text> : null}
              <View style={[{ flexDirection: isRTL ? 'row-reverse' : 'row', alignItems: 'center', marginTop: 4 }]}>
                <View style={[styles.rolePill, { backgroundColor: user.role === 'admin' ? '#E8EAF6' : (user.role === 'driver' ? '#FFF3E0' : '#EEEEEE') }]}>
                  <Text style={[styles.rolePillText, { color: user.role === 'admin' ? COLORS.primary : (user.role === 'driver' ? '#E65100' : '#757575') }]}>
                    {t(user.role)}
                  </Text>
                </View>
                <Text style={[styles.userDate, isRTL ? { marginRight: 8 } : { marginLeft: 8 }]}>
                  {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : ''}
                </Text>
              </View>
            </View>
          </View>
          
          <TouchableOpacity onPress={() => startEditUser(user)} style={{ padding: 8 }}>
            <MaterialCommunityIcons name="account-edit" size={22} color={COLORS.primary} />
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              const msg = t('confirm_delete_user');
              if (Platform.OS === 'web') {
                if (window.confirm(msg)) deleteUser(user.id);
              } else {
                Alert.alert(t('confirm'), msg, [
                  { text: t('back'), style: 'cancel' },
                  { text: t('remove'), style: 'destructive', onPress: () => deleteUser(user.id) }
                ]);
              }
            }}
            style={styles.deleteUserBtn}
          >
            <MaterialCommunityIcons name="account-remove" size={22} color="#F44336" />
          </TouchableOpacity>
        </View>
      ))}

      {/* Edit User Modal (Inline View) */}
      {editingUser && (
        <View style={[styles.addCard, { marginTop: 20, borderColor: COLORS.primary, borderWidth: 1 }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 15 }}>
            <Text style={styles.sectionLabel}>{t('edit_user') || 'Edit User'}</Text>
            <TouchableOpacity onPress={() => setEditingUser(null)}>
              <MaterialCommunityIcons name="close" size={20} color={COLORS.textGray} />
            </TouchableOpacity>
          </View>
          
          <TextInput style={[styles.input, { textAlign: isRTL ? 'right' : 'left' }]} placeholder={t('buyer_name')} value={editName} onChangeText={setEditName}/>
          <TextInput style={[styles.input, { textAlign: isRTL ? 'right' : 'left' }]} placeholder={t('email')} value={editEmail} onChangeText={setEditEmail} keyboardType="email-address" autoCapitalize="none"/>
          <TextInput style={[styles.input, { textAlign: isRTL ? 'right' : 'left' }]} placeholder={t('phone')} value={editPhone} onChangeText={setEditPhone} keyboardType="phone-pad"/>
          <TextInput style={[styles.input, { textAlign: isRTL ? 'right' : 'left' }]} placeholder={`${t('password')} (${t('optional') || 'leave blank to keep current'})`} value={editPassword} onChangeText={setEditPassword} secureTextEntry/>
          <TextInput style={[styles.input, { textAlign: isRTL ? 'right' : 'left' }]} placeholder={t('mfa_code') || 'MFA Code'} value={editMfaCode} onChangeText={setEditMfaCode} keyboardType="numeric"/>
          
          <Text style={[styles.sectionLabel, { textAlign: isRTL ? 'right' : 'left' }]}>{t('select_role')}</Text>
          <View style={[styles.row, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
            <TouchableOpacity style={[styles.categoryBtn, editRole === 'admin' && styles.activeCat]} onPress={() => setEditRole('admin')}>
              <MaterialCommunityIcons name="shield-account" size={16} color={editRole === 'admin' ? '#FFF' : COLORS.textGray} />
              <Text style={[{ marginLeft: 4 }, editRole === 'admin' ? styles.activeCatText : {}]}>{t('admin')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.categoryBtn, editRole === 'driver' && styles.activeCat]} onPress={() => setEditRole('driver')}>
              <MaterialCommunityIcons name="truck-delivery" size={16} color={editRole === 'driver' ? '#FFF' : COLORS.textGray} />
              <Text style={[{ marginLeft: 4 }, editRole === 'driver' ? styles.activeCatText : {}]}>{t('driver')}</Text>
            </TouchableOpacity>
          </View>
          
          <TouchableOpacity style={styles.addBtn} onPress={handleUpdateUser}>
            <Text style={styles.addBtnText}>{t('save') || 'Save Changes'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  const renderArchive = () => (
    <View style={styles.tabContent}>
      <Text style={[styles.tabTitle, { textAlign: isRTL ? 'right' : 'left' }]}>{t('order_archive')}</Text>
      {completedOrders.length === 0 ? (
        <Text style={[styles.restrictedText, { color: COLORS.textGray, fontStyle: 'italic' }]}>{t('no_completed_orders')}</Text>
      ) : (
        completedOrders.map(order => (
          <View key={order.id} style={styles.archiveCard}>
            <View style={[styles.archiveHeader, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
              <Text style={[styles.archiveOrderId, { textAlign: isRTL ? 'right' : 'left' }]}>{t('order_id')} #{order.id}</Text>
              <View style={styles.completedBadge}>
                <MaterialCommunityIcons name="check-circle" size={14} color="#2E7D32" />
                <Text style={styles.completedText}>{t('mark_completed') || 'Completed'}</Text>
              </View>
            </View>
            <View style={{ marginTop: 8 }}>
              <Text style={[styles.archiveDetail, { textAlign: isRTL ? 'right' : 'left' }]}>
                <Text style={{ fontWeight: 'bold' }}>{t('customer')}: </Text>{order.customer || '—'}
              </Text>
              <Text style={[styles.archiveDetail, { textAlign: isRTL ? 'right' : 'left' }]}>
                <Text style={{ fontWeight: 'bold' }}>{t('order_date')}: </Text>{order.timestamp ? new Date(order.timestamp).toLocaleDateString() : '—'}
              </Text>
              <Text style={[styles.archiveDetail, { textAlign: isRTL ? 'right' : 'left' }]}>
                <Text style={{ fontWeight: 'bold' }}>{t('order_total') || 'Total'}: </Text>{order.total || '—'} {t('currency') || 'MAD'}
              </Text>
            </View>
            {order.items && order.items.length > 0 && (
              <View style={styles.archiveItemsList}>
                <Text style={[styles.archiveItemsTitle, { textAlign: isRTL ? 'right' : 'left' }]}>{t('order_items')}:</Text>
                {order.items.map((item, idx) => (
                  <Text key={idx} style={[styles.archiveItemRow, { textAlign: isRTL ? 'right' : 'left' }]}>
                    • {item.name || t(item.name)} × {item.quantity || 1} — {item.price || ''}
                  </Text>
                ))}
              </View>
            )}
          </View>
        ))
      )}
    </View>
  );

  if (isLoading) {
    return <View style={styles.mfaContainer}><ActivityIndicator size="large" color={COLORS.primary}/></View>;
  }

  return (
    <View style={styles.container}>
      {userRole === 'owner' && (
        <View style={styles.roleHeader}>
           <TouchableOpacity onPress={() => setRole(role === 'owner' ? 'driver' : (role === 'driver' ? 'admin' : 'owner'))}>
              <Text style={styles.roleToggleText}>{t('active_role')}: <Text style={{fontWeight:'bold'}}>{role.toUpperCase()}</Text> ({t('tap_to_switch')})</Text>
           </TouchableOpacity>
        </View>
      )}

      <View style={[styles.header, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
        <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
          <MaterialCommunityIcons name="logout" size={20} color="#F44336" />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { textAlign: isRTL ? 'right' : 'left', flex: 1 }]}>{t('admin_panel')}</Text>
        <View style={[styles.langSwitcher, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
          {languages.map((lang) => (
            <TouchableOpacity key={lang.code} onPress={() => changeLanguage(lang.code)} style={[styles.langButton, i18n.language === lang.code && styles.langButtonActive]}>
              <Text style={[styles.langText, i18n.language === lang.code && styles.langTextActive]}>{lang.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* Tab Navigation */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ maxHeight: 50, marginBottom: 10 }} contentContainerStyle={[styles.switcher, { flexDirection: isRTL ? 'row-reverse' : 'row' }]}>
        {isAdmin && (
           <TouchableOpacity style={[styles.switchTab, activeTab === 'inventory' && styles.activeTab]} onPress={() => setActiveTab('inventory')}>
             <MaterialCommunityIcons name="package-variant-closed" size={18} color={activeTab === 'inventory' ? COLORS.white : COLORS.textGray} />
             <Text style={[styles.switchText, activeTab === 'inventory' && styles.activeTabText]}>{t('stock')}</Text>
           </TouchableOpacity>
        )}
        <TouchableOpacity style={[styles.switchTab, activeTab === 'orders' && styles.activeTab]} onPress={() => setActiveTab('orders')}>
          <MaterialCommunityIcons name="truck-delivery" size={18} color={activeTab === 'orders' ? COLORS.white : COLORS.textGray} />
          <Text style={[styles.switchText, activeTab === 'orders' && styles.activeTabText]}>{t('orders')}</Text>
        </TouchableOpacity>
        {role === 'owner' && userRole === 'owner' && (
          <>
            <TouchableOpacity style={[styles.switchTab, activeTab === 'finance' && styles.activeTab]} onPress={() => setActiveTab('finance')}>
              <MaterialCommunityIcons name="finance" size={18} color={activeTab === 'finance' ? COLORS.white : COLORS.textGray} />
              <Text style={[styles.switchText, activeTab === 'finance' && styles.activeTabText]}>{t('finance')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.switchTab, activeTab === 'users' && styles.activeTab]} onPress={() => setActiveTab('users')}>
              <MaterialCommunityIcons name="account-group" size={18} color={activeTab === 'users' ? COLORS.white : COLORS.textGray} />
              <Text style={[styles.switchText, activeTab === 'users' && styles.activeTabText]}>{t('users_management')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.switchTab, activeTab === 'archive' && styles.activeTab]} onPress={() => setActiveTab('archive')}>
              <MaterialCommunityIcons name="archive" size={18} color={activeTab === 'archive' ? COLORS.white : COLORS.textGray} />
              <Text style={[styles.switchText, activeTab === 'archive' && styles.activeTabText]}>{t('archive')}</Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>

      <ScrollView contentContainerStyle={{ paddingBottom: 50 }}>
        {activeTab === 'inventory' && renderInventory()}
        {activeTab === 'orders' && renderOrders()}
        {activeTab === 'finance' && role === 'owner' && userRole === 'owner' && renderFinancials()}
        {activeTab === 'users' && role === 'owner' && userRole === 'owner' && renderUsers()}
        {activeTab === 'archive' && role === 'owner' && userRole === 'owner' && renderArchive()}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA', paddingTop: 20 },
  roleHeader: { backgroundColor: '#FFD54F', padding: 8, alignItems: 'center' },
  roleToggleText: { fontSize: 11, color: '#000' },
  header: { alignItems: 'center', paddingHorizontal: 20, paddingTop: 20, marginBottom: 15 },
  headerTitle: { fontSize: 24, fontWeight: 'bold' },
  langSwitcher: { flexDirection: 'row', backgroundColor: '#FFF', borderRadius: 8, padding: 2, elevation: 2 },
  langButton: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 6 },
  langButtonActive: { backgroundColor: COLORS.primary },
  langText: { fontSize: 11, fontWeight: 'bold', color: COLORS.textGray },
  langTextActive: { color: COLORS.white },
  switcher: { paddingHorizontal: 15 },
  switchTab: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, marginRight: 6, elevation: 2 },
  activeTab: { backgroundColor: COLORS.primary },
  switchText: { marginLeft: 5, fontSize: 11, color: COLORS.textGray },
  activeTabText: { color: COLORS.white },
  tabContent: { paddingHorizontal: 20 },
  tabTitle: { fontSize: 20, fontWeight: 'bold', marginBottom: 15 },
  tabSubText: { color: COLORS.textGray, marginTop: 15, fontSize: 12, fontStyle: 'italic' },
  restrictedText: { color: '#F44336', textAlign: 'center', marginVertical: 30, fontStyle: 'italic' },
  addCard: { backgroundColor: '#FFF', padding: 15, borderRadius: 15, marginBottom: 20, elevation: 3 },
  input: { borderBottomWidth: 1, borderColor: '#EEE', paddingVertical: 8, marginBottom: 15 },
  sectionLabel: { fontSize: 14, fontWeight: '700', color: COLORS.black, marginBottom: 8 },
  row: { flexDirection: 'row', marginBottom: 15, flexWrap: 'wrap' },
  categoryBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: '#DDD', marginRight: 8, marginBottom: 6 },
  activeCat: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  activeCatText: { color: '#FFF' },
  addBtn: { backgroundColor: COLORS.primary, padding: 12, borderRadius: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'center' },
  addBtnText: { color: '#FFF', fontWeight: 'bold' },
  listItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FFF', padding: 12, borderRadius: 12, marginBottom: 10 },
  itemName: { fontWeight: 'bold', fontSize: 15 },
  itemSub: { color: COLORS.textGray, fontSize: 12 },
  itemControlRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  stockBtn: { backgroundColor: '#F0F0F0', borderRadius: 6, padding: 6, marginHorizontal: 2 },
  smallInput: { backgroundColor: '#F0F0F0', borderRadius: 5, paddingHorizontal: 8, paddingVertical: 4, width: 55, fontSize: 11, marginLeft: 6 },
  financeCard: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#2E7D32', padding: 25, borderRadius: 15, elevation: 4 },
  financeLabel: { color: '#E8F5E9', fontSize: 12 },
  financeValue: { color: '#FFF', fontSize: 24, fontWeight: 'bold' },
  orderCard: { backgroundColor: '#FFF', padding: 15, borderRadius: 15, marginBottom: 15, elevation: 2 },
  orderHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  orderId: { fontWeight: 'bold' },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 5 },
  customerName: { fontSize: 16, fontWeight: '600' },
  driverName: { color: COLORS.textGray, fontSize: 12, marginBottom: 15 },
  orderActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 },
  gpsBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#34A853', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  gpsText: { color: '#FFF', marginLeft: 5, fontWeight: '600' },
  assignBtn: { backgroundColor: COLORS.secondary, paddingHorizontal: 15, paddingVertical: 8, borderRadius: 8 },
  assignText: { color: '#FFF', fontWeight: '600' },
  mfaContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },

  // Category Filter
  catFilterBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFF', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, marginRight: 8, elevation: 1, borderWidth: 1, borderColor: '#E0E0E0' },
  catFilterBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  catFilterText: { fontSize: 11, marginLeft: 4, color: COLORS.textGray, fontWeight: '600' },
  catFilterTextActive: { color: COLORS.white },

  // Archive
  archiveCard: { backgroundColor: '#FFF', padding: 15, borderRadius: 15, marginBottom: 12, elevation: 2, borderLeftWidth: 4, borderLeftColor: '#4CAF50' },
  archiveHeader: { justifyContent: 'space-between', alignItems: 'center' },
  archiveOrderId: { fontWeight: 'bold', fontSize: 14 },
  completedBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E8F5E9', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12 },
  completedText: { fontSize: 10, color: '#2E7D32', fontWeight: '600', marginLeft: 4 },
  archiveDetail: { fontSize: 13, color: '#555', marginBottom: 4 },
  archiveItemsList: { marginTop: 10, backgroundColor: '#FAFAFA', padding: 10, borderRadius: 8 },
  archiveItemsTitle: { fontSize: 12, fontWeight: 'bold', color: COLORS.primary, marginBottom: 6 },
  archiveItemRow: { fontSize: 12, color: '#444', marginBottom: 3 },

  // User Cards
  userCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFF', padding: 14, borderRadius: 14, marginBottom: 10, elevation: 2 },
  userAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  userName: { fontSize: 15, fontWeight: '700', color: '#333' },
  userEmail: { fontSize: 12, color: COLORS.textGray, marginTop: 1 },
  rolePill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  rolePillText: { fontSize: 10, fontWeight: '700' },
  userDate: { fontSize: 10, color: COLORS.textGray },
  deleteUserBtn: { padding: 8 },
  logoutBtn: { padding: 8, marginRight: 10 },
  
  // Modal & Overlay
  modalOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000, justifyContent: 'center' },
  modalScroll: { padding: 20, justifyContent: 'center', minHeight: '100%' },
  modalCard: { backgroundColor: '#FFF', borderRadius: 20, padding: 25, elevation: 10 },
  modalTitle: { fontSize: 20, fontWeight: 'bold', color: COLORS.black, marginBottom: 20 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: COLORS.textGray, marginBottom: 5 },
  unitBtn: { flex: 1, backgroundColor: '#F0F0F0', paddingVertical: 10, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#EEE' },
  unitBtnActive: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  unitText: { fontSize: 13, color: COLORS.textGray, fontWeight: '600' },
  unitTextActive: { color: '#FFF' },
  saveBtn: { backgroundColor: COLORS.primary, padding: 15, borderRadius: 12, alignItems: 'center', marginTop: 10, shadowColor: COLORS.primary, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 5 },
  saveBtnText: { color: '#FFF', fontWeight: 'bold', fontSize: 16 }
});

export default AdminDashboardScreen;
