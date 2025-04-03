const express = require('express');
const { supabase } = require('../config/supabase');
const router = express.Router();
const { getUserById } = require('../utils/user');
const axios = require('axios');

// eBay API Configuration
const EBAY_CONFIG = {
  appId: process.env.EBAY_APP_ID || 'Buzz...',
  certId: process.env.EBAY_CERT_ID || 'SBX-...',
  devId: process.env.EBAY_DEV_ID || 'fef1...',
  authToken: process.env.EBAY_AUTH_TOKEN || 'v^1....',
  sandboxMode: process.env.EBAY_SANDBOX_MODE === 'true' || true
};

// eBay API base URL based on sandbox mode
const EBAY_API_URL = EBAY_CONFIG.sandboxMode 
  ? 'https://api.sandbox.ebay.com'
  : 'https://api.ebay.com';

/**
 * @api {get} /api/admin/stats Get dashboard statistics
 * @apiDescription Get key statistics for the admin dashboard
 * @apiName GetDashboardStats
 * @apiGroup Admin
 * 
 * @apiSuccess {Object} data Dashboard statistics
 */
router.get('/stats', async (req, res) => {
  try {
    // Total revenue calculation
    const { data: salesData, error: salesError } = await supabase
      .from('sales')
      .select('price, fee, net_amount');
    
    if (salesError) throw salesError;
    
    const totalRevenue = salesData.reduce((sum, sale) => sum + parseFloat(sale.price || 0), 0);
    const totalProfit = salesData.reduce((sum, sale) => sum + parseFloat(sale.fee || 0), 0);
    
    // Active users count
    const { count: userCount, error: usersError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true });
    
    if (usersError) throw usersError;
    
    // Active listings count
    const { count: activeListingCount, error: listingsError } = await supabase
      .from('listings')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');
    
    if (listingsError) throw listingsError;
    
    // Completed sales count
    const { count: soldCount, error: completedSalesError } = await supabase
      .from('listings')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'sold');
    
    if (completedSalesError) throw completedSalesError;
    
    res.json({
      success: true,
      stats: {
        totalRevenue,
        totalProfit,
        userCount,
        activeListingCount,
        soldCount
      }
    });
  } catch (error) {
    console.error('Error fetching admin stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch admin statistics'
    });
  }
});

/**
 * @api {get} /api/admin/users Get all users
 * @apiDescription Get a paginated list of all users
 * @apiName GetUsers
 * @apiGroup Admin
 * 
 * @apiParam {Number} [page=1] Page number
 * @apiParam {Number} [limit=10] Number of users per page
 * @apiParam {String} [search] Search term to filter users by name or phone
 * @apiParam {String} [sort_by=created_at] Field to sort by
 * @apiParam {String} [sort_dir=desc] Sort direction (asc or desc)
 * 
 * @apiSuccess {Object[]} users Array of users
 * @apiSuccess {Number} count Total count of users
 */
router.get('/users', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search = '', 
      sort_by = 'created_at', 
      sort_dir = 'desc' 
    } = req.query;
    
    // Calculate offset for pagination
    const offset = (page - 1) * limit;
    
    // Start building query
    let query = supabase
      .from('users')
      .select(`
        *,
        listings(count),
        sales(count)
      `, { count: 'exact' });
    
    // Add search filter if provided
    if (search) {
      query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
    }
    
    // Add sorting
    query = query.order(sort_by, { ascending: sort_dir === 'asc' });
    
    // Add pagination
    query = query.range(offset, offset + limit - 1);
    
    // Execute query
    const { data: users, count, error } = await query;
    
    if (error) throw error;
    
    // Format user data for frontend
    const formattedUsers = users.map(user => ({
      id: user.id,
      name: user.name,
      phone: user.phone,
      email: user.email,
      created_at: user.created_at,
      updated_at: user.updated_at,
      zelle_id: user.zelle_id,
      paypal_id: user.paypal_id,
      venmo_id: user.venmo_id,
      cashapp_id: user.cashapp_id,
      active_listings_count: user.listings ? user.listings.length : 0,
      sold_items_count: user.sales ? user.sales.length : 0
    }));
    
    res.json({
      success: true,
      users: formattedUsers,
      count
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch users'
    });
  }
});

/**
 * @api {get} /api/admin/users/:id Get user by ID
 * @apiDescription Get detailed information about a specific user
 * @apiName GetUserById
 * @apiGroup Admin
 * 
 * @apiParam {String} id User ID
 * 
 * @apiSuccess {Object} user User details
 */
router.get('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await getUserById(id);
    
    if (!result.success) {
      return res.status(404).json({
        success: false,
        message: result.message
      });
    }
    
    res.json({
      success: true,
      user: result.user
    });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch user'
    });
  }
});

/**
 * @api {delete} /api/admin/users/:id Delete a user
 * @apiDescription Delete a user and all associated data
 * @apiName DeleteUser
 * @apiGroup Admin
 * 
 * @apiParam {String} id User ID
 * 
 * @apiSuccess {Boolean} success Indicates if the operation was successful
 */
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Delete user from database
    const { error } = await supabase
      .from('users')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    
    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete user'
    });
  }
});

/**
 * @api {get} /api/admin/listings Get all listings
 * @apiDescription Get a paginated list of all listings
 * @apiName GetListings
 * @apiGroup Admin
 * 
 * @apiParam {Number} [page=1] Page number
 * @apiParam {Number} [limit=12] Number of listings per page
 * @apiParam {String} [search] Search term to filter listings by title or description
 * @apiParam {String} [status] Filter by listing status
 * @apiParam {Number} [min_price] Filter by minimum price
 * @apiParam {Number} [max_price] Filter by maximum price
 * @apiParam {String} [sort_by=created_at] Field to sort by
 * @apiParam {String} [sort_dir=desc] Sort direction (asc or desc)
 * 
 * @apiSuccess {Object[]} listings Array of listings
 * @apiSuccess {Number} count Total count of listings
 */
router.get('/listings', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 12, 
      search = '', 
      status = '',
      min_price = '',
      max_price = '',
      sort_by = 'created_at', 
      sort_dir = 'desc' 
    } = req.query;
    
    // Calculate offset for pagination
    const offset = (page - 1) * limit;
    
    // Start building query
    let query = supabase
      .from('listings')
      .select(`
        *,
        users(name)
      `, { count: 'exact' });
    
    // Add search filter if provided
    if (search) {
      query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%`);
    }
    
    // Add status filter if provided
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }
    
    // Add price filters if provided
    if (min_price) {
      query = query.gte('price', min_price);
    }
    
    if (max_price) {
      query = query.lte('price', max_price);
    }
    
    // Add sorting
    query = query.order(sort_by, { ascending: sort_dir === 'asc' });
    
    // Add pagination
    query = query.range(offset, offset + limit - 1);
    
    // Execute query
    const { data: listings, count, error } = await query;
    
    if (error) throw error;
    
    // Format listing data for frontend
    const formattedListings = listings.map(listing => ({
      id: listing.id,
      title: listing.title,
      description: listing.description,
      price: listing.price,
      images: listing.images,
      status: listing.status,
      created_at: listing.created_at,
      updated_at: listing.updated_at,
      user_id: listing.user_id,
      user_name: listing.users?.name || 'Unknown'
    }));
    
    res.json({
      success: true,
      listings: formattedListings,
      count
    });
  } catch (error) {
    console.error('Error fetching listings:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch listings'
    });
  }
});

/**
 * @api {get} /api/admin/listings/:id Get listing by ID
 * @apiDescription Get detailed information about a specific listing
 * @apiName GetListingById
 * @apiGroup Admin
 * 
 * @apiParam {String} id Listing ID
 * 
 * @apiSuccess {Object} listing Listing details
 */
router.get('/listings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get listing from database
    const { data: listing, error } = await supabase
      .from('listings')
      .select(`
        *,
        users(name, phone)
      `)
      .eq('id', id)
      .single();
    
    if (error) throw error;
    
    if (!listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }
    
    res.json({
      success: true,
      listing
    });
  } catch (error) {
    console.error('Error fetching listing:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch listing'
    });
  }
});

/**
 * @api {put} /api/admin/listings/:id Update a listing
 * @apiDescription Update listing details
 * @apiName UpdateListing
 * @apiGroup Admin
 * 
 * @apiParam {String} id Listing ID
 * @apiParam {String} [title] Listing title
 * @apiParam {String} [description] Listing description
 * @apiParam {Number} [price] Listing price
 * @apiParam {String} [status] Listing status (active, pending, sold, removed)
 * 
 * @apiSuccess {Boolean} success Indicates if the update was successful
 * @apiSuccess {Object} listing Updated listing
 */
router.put('/listings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, price, status } = req.body;
    
    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (price !== undefined) updates.price = price;
    if (status !== undefined) updates.status = status;
    
    updates.updated_at = new Date().toISOString();
    
    // Update listing in database
    const { data: updatedListing, error } = await supabase
      .from('listings')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({
      success: true,
      listing: updatedListing
    });
  } catch (error) {
    console.error('Error updating listing:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update listing'
    });
  }
});

/**
 * @api {put} /api/admin/listings/:id/status Update listing status
 * @apiDescription Update just the status of a listing
 * @apiName UpdateListingStatus
 * @apiGroup Admin
 * 
 * @apiParam {String} id Listing ID
 * @apiParam {String} status New status (active, pending, sold, removed)
 * 
 * @apiSuccess {Boolean} success Indicates if the status update was successful
 */
router.put('/listings/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }
    
    // Validate status
    const validStatuses = ['active', 'pending', 'sold', 'removed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be one of: ' + validStatuses.join(', ')
      });
    }
    
    // Update listing status
    const { data, error } = await supabase
      .from('listings')
      .update({ 
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);
    
    if (error) throw error;
    
    res.json({
      success: true,
      message: 'Listing status updated successfully'
    });
  } catch (error) {
    console.error('Error updating listing status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update listing status'
    });
  }
});

/**
 * @api {get} /api/admin/payouts/stats Get payout statistics
 * @apiDescription Get statistics for payouts (pending, monthly, processing time)
 * @apiName GetPayoutStats
 * @apiGroup Admin
 * 
 * @apiSuccess {Object} data Payout statistics
 */
router.get('/payouts/stats', async (req, res) => {
  try {
    // Get pending payouts data
    const { data: pendingPayouts, error: pendingError } = await supabase
      .from('payouts')
      .select('amount')
      .eq('status', 'pending');
    
    if (pendingError) throw pendingError;
    
    // Calculate pending amount and count
    const pendingAmount = pendingPayouts.reduce((sum, payout) => sum + parseFloat(payout.amount || 0), 0);
    const pendingCount = pendingPayouts.length;
    
    // Get current month's payouts
    const now = new Date();
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString();
    
    const { data: monthlyPayouts, error: monthlyError } = await supabase
      .from('payouts')
      .select('amount, created_at, updated_at, status')
      .gte('created_at', firstDayOfMonth)
      .lte('created_at', lastDayOfMonth);
    
    if (monthlyError) throw monthlyError;
    
    // Calculate monthly amount and count
    const monthlyAmount = monthlyPayouts.reduce((sum, payout) => sum + parseFloat(payout.amount || 0), 0);
    const monthlyCount = monthlyPayouts.length;
    
    // Calculate average processing time (for completed payouts)
    const completedPayouts = monthlyPayouts.filter(payout => payout.status === 'paid');
    let avgProcessingDays = 0;
    
    if (completedPayouts.length > 0) {
      const processingTimes = completedPayouts.map(payout => {
        const createdDate = new Date(payout.created_at);
        const updatedDate = new Date(payout.updated_at);
        const diffTime = Math.abs(updatedDate - createdDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
      });
      
      avgProcessingDays = processingTimes.reduce((sum, days) => sum + days, 0) / processingTimes.length;
    }
    
    // Get previous month's data to calculate processing time change
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString();
    
    const { data: prevMonthPayouts, error: prevMonthError } = await supabase
      .from('payouts')
      .select('created_at, updated_at, status')
      .gte('created_at', prevMonthStart)
      .lte('created_at', prevMonthEnd)
      .eq('status', 'paid');
    
    if (prevMonthError) throw prevMonthError;
    
    // Calculate previous month's average processing time
    let prevAvgProcessingDays = 0;
    
    if (prevMonthPayouts.length > 0) {
      const processingTimes = prevMonthPayouts.map(payout => {
        const createdDate = new Date(payout.created_at);
        const updatedDate = new Date(payout.updated_at);
        const diffTime = Math.abs(updatedDate - createdDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return diffDays;
      });
      
      prevAvgProcessingDays = processingTimes.reduce((sum, days) => sum + days, 0) / processingTimes.length;
    }
    
    // Calculate processing time change
    let processingDaysChange = 0;
    if (prevAvgProcessingDays > 0) {
      processingDaysChange = Math.round((avgProcessingDays - prevAvgProcessingDays) * 10) / 10;
    }
    
    res.json({
      success: true,
      pendingAmount,
      pendingCount,
      monthlyAmount,
      monthlyCount,
      avgProcessingDays: Math.round(avgProcessingDays * 10) / 10,
      processingDaysChange
    });
  } catch (error) {
    console.error('Error fetching payout stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payout statistics'
    });
  }
});

/**
 * @api {get} /api/admin/payouts Get all payouts
 * @apiDescription Get a paginated list of all payouts
 * @apiName GetPayouts
 * @apiGroup Admin
 * 
 * @apiParam {Number} [page=1] Page number
 * @apiParam {Number} [limit=10] Number of payouts per page
 * @apiParam {String} [status] Filter by payout status
 * @apiParam {String} [sort_by=created_at] Field to sort by
 * @apiParam {String} [sort_dir=desc] Sort direction (asc or desc)
 * 
 * @apiSuccess {Object[]} payouts Array of payouts
 * @apiSuccess {Number} count Total count of payouts
 */
router.get('/payouts', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      status = '',
      sort_by = 'created_at', 
      sort_dir = 'desc' 
    } = req.query;
    
    // Calculate offset for pagination
    const offset = (page - 1) * limit;
    
    // Start building query
    let query = supabase
      .from('payouts')
      .select(`
        *,
        users(name)
      `, { count: 'exact' });
    
    // Add status filter if provided
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }
    
    // Add sorting
    query = query.order(sort_by, { ascending: sort_dir === 'asc' });
    
    // Add pagination
    query = query.range(offset, offset + limit - 1);
    
    // Execute query
    const { data: payouts, count, error } = await query;
    
    if (error) throw error;
    
    // Format payout data for frontend
    const formattedPayouts = payouts.map(payout => ({
      id: payout.id,
      user_id: payout.user_id,
      user_name: payout.users?.name || 'Unknown',
      amount: payout.amount,
      status: payout.status,
      payment_method: payout.payment_method,
      payment_id: payout.payment_id,
      created_at: payout.created_at,
      updated_at: payout.updated_at
    }));
    
    res.json({
      success: true,
      payouts: formattedPayouts,
      count
    });
  } catch (error) {
    console.error('Error fetching payouts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payouts'
    });
  }
});

/**
 * @api {post} /api/admin/process-payout/:id Process a payout
 * @apiDescription Mark a payout as processed
 * @apiName ProcessPayout
 * @apiGroup Admin
 * 
 * @apiParam {String} id Payout ID
 * 
 * @apiSuccess {Boolean} success Indicates if the operation was successful
 */
router.post('/process-payout/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Update payout status
    const { data: payout, error } = await supabase
      .from('payouts')
      .update({ 
        status: 'paid',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({
      success: true,
      message: 'Payout processed successfully',
      payout
    });
  } catch (error) {
    console.error('Error processing payout:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process payout'
    });
  }
});

/**
 * @api {post} /api/admin/payouts/process-all Process all pending payouts
 * @apiDescription Mark all pending payouts as processed
 * @apiName ProcessAllPayouts
 * @apiGroup Admin
 * 
 * @apiSuccess {Boolean} success Indicates if the operation was successful
 * @apiSuccess {Number} processed_count Number of payouts processed
 */
router.post('/payouts/process-all', async (req, res) => {
  try {
    // Find all pending payouts
    const { data: pendingPayouts, error: findError } = await supabase
      .from('payouts')
      .select('id')
      .eq('status', 'pending');
    
    if (findError) throw findError;
    
    if (pendingPayouts.length === 0) {
      return res.json({
        success: true,
        message: 'No pending payouts to process',
        processed_count: 0
      });
    }
    
    // Update all pending payouts to paid status
    const { data: updatedPayouts, error: updateError } = await supabase
      .from('payouts')
      .update({ 
        status: 'paid',
        updated_at: new Date().toISOString()
      })
      .eq('status', 'pending')
      .select();
    
    if (updateError) throw updateError;
    
    res.json({
      success: true,
      message: 'All pending payouts processed successfully',
      processed_count: updatedPayouts.length
    });
  } catch (error) {
    console.error('Error processing all payouts:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process all payouts'
    });
  }
});

/**
 * @api {get} /api/admin/support-chats Get all support chats
 * @apiDescription Get a paginated list of all support chats
 * @apiName GetSupportChats
 * @apiGroup Admin
 * 
 * @apiParam {Number} [page=1] Page number
 * @apiParam {Number} [limit=10] Number of chats per page
 * @apiParam {String} [status] Filter by chat status
 * @apiParam {String} [sort_by=created_at] Field to sort by
 * @apiParam {String} [sort_dir=desc] Sort direction (asc or desc)
 * 
 * @apiSuccess {Object[]} chats Array of support chats
 * @apiSuccess {Number} count Total count of chats
 */
router.get('/support-chats', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      status = '',
      sort_by = 'created_at', 
      sort_dir = 'desc' 
    } = req.query;
    
    // Calculate offset for pagination
    const offset = (page - 1) * limit;
    
    // Start building query
    let query = supabase
      .from('support_chats')
      .select(`
        *,
        users(name)
      `, { count: 'exact' });
    
    // Add status filter if provided
    if (status && status !== 'all') {
      query = query.eq('status', status);
    }
    
    // Add sorting
    query = query.order(sort_by, { ascending: sort_dir === 'asc' });
    
    // Add pagination
    query = query.range(offset, offset + limit - 1);
    
    // Execute query
    const { data: chats, count, error } = await query;
    
    if (error) throw error;
    
    res.json({
      success: true,
      chats,
      count
    });
  } catch (error) {
    console.error('Error fetching support chats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch support chats'
    });
  }
});

/**
 * @api {get} /api/admin/support-chats/:id Get a support chat
 * @apiDescription Get a specific support chat by ID
 * @apiName GetSupportChat
 * @apiGroup Admin
 * 
 * @apiParam {String} id Support chat ID
 * 
 * @apiSuccess {Object} chat Support chat details
 */
router.get('/support-chats/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get chat
    const { data: chat, error } = await supabase
      .from('support_chats')
      .select(`
        *,
        users(name, phone)
      `)
      .eq('id', id)
      .single();
    
    if (error) throw error;
    
    if (!chat) {
      return res.status(404).json({
        success: false,
        message: 'Support chat not found'
      });
    }
    
    res.json({
      success: true,
      chat
    });
  } catch (error) {
    console.error('Error fetching support chat:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch support chat'
    });
  }
});

/**
 * @api {post} /api/admin/support-chats/:id/respond Respond to a support chat
 * @apiDescription Admin response to a support chat
 * @apiName RespondToSupportChat
 * @apiGroup Admin
 * 
 * @apiParam {String} id Support chat ID
 * @apiParam {String} response Admin response message
 * 
 * @apiSuccess {Boolean} success Indicates if the operation was successful
 */
router.post('/support-chats/:id/respond', async (req, res) => {
  try {
    const { id } = req.params;
    const { response } = req.body;
    
    if (!response) {
      return res.status(400).json({
        success: false,
        message: 'Response message is required'
      });
    }
    
    // Update chat with admin response
    const { data: chat, error } = await supabase
      .from('support_chats')
      .update({ 
        admin_response: response,
        status: 'responded',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({
      success: true,
      message: 'Response sent successfully',
      chat
    });
  } catch (error) {
    console.error('Error responding to support chat:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to send response'
    });
  }
});

/**
 * @api {put} /api/admin/support-chats/:id/status Update support chat status
 * @apiDescription Update the status of a support chat
 * @apiName UpdateSupportChatStatus
 * @apiGroup Admin
 * 
 * @apiParam {String} id Support chat ID
 * @apiParam {String} status New status (pending, responded, resolved)
 * 
 * @apiSuccess {Boolean} success Indicates if the status update was successful
 */
router.put('/support-chats/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    
    if (!status) {
      return res.status(400).json({
        success: false,
        message: 'Status is required'
      });
    }
    
    // Validate status
    const validStatuses = ['pending', 'responded', 'resolved'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be one of: ' + validStatuses.join(', ')
      });
    }
    
    // Update chat status
    const { data: chat, error } = await supabase
      .from('support_chats')
      .update({ 
        status,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({
      success: true,
      message: 'Support chat status updated successfully',
      chat
    });
  } catch (error) {
    console.error('Error updating support chat status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update status'
    });
  }
});

/**
 * @api {post} /api/admin/payouts/:id/process Process a specific payout
 * @apiDescription Mark a specific payout as processed
 * @apiName ProcessPayout
 * @apiGroup Admin
 * 
 * @apiParam {String} id Payout ID
 * 
 * @apiSuccess {Boolean} success Indicates if the operation was successful
 * @apiSuccess {Object} payout The processed payout
 */
router.post('/payouts/:id/process', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if payout exists and is pending
    const { data: existingPayout, error: findError } = await supabase
      .from('payouts')
      .select('*')
      .eq('id', id)
      .single();
    
    if (findError) {
      return res.status(404).json({
        success: false,
        message: 'Payout not found'
      });
    }
    
    if (existingPayout.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot process payout with status '${existingPayout.status}'`
      });
    }
    
    // Update payout status
    const { data: updatedPayout, error: updateError } = await supabase
      .from('payouts')
      .update({ 
        status: 'paid',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();
    
    if (updateError) throw updateError;
    
    res.json({
      success: true,
      message: 'Payout processed successfully',
      payout: updatedPayout
    });
  } catch (error) {
    console.error('Error processing payout:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process payout'
    });
  }
});

// Export the router module
module.exports = router; 