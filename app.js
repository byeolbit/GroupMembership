var fs = require('fs');
var express = require('express');  
var app = express();  
var server = require('http').createServer(app);  
var io = require('socket.io')(server);

app.use(express.static(__dirname + '/bower_components'));  
app.get('/', function(req, res,next) {  
    res.sendFile(__dirname + '/index.html');
});

var clientList = {};
var groups = {};
var families = {};
var date = new Date();

function recordData(type) {
    switch (type)
    {
        case 'agent' :
            fs.writeFile('log/server_'+date.getDate()+'_'+date.getHours()+'_'+date.getMinutes()+'_'+date.getMilliseconds()+'clientList.txt', JSON.stringify(clientList,null,2));
            break;
        case 'group' :
            fs.writeFile('log/server_'+date.getDate()+'_'+date.getHours()+'_'+date.getMinutes()+'_'+date.getMilliseconds()+'groupList.txt', JSON.stringify(groups,null,2));
            break;
        case 'family' :
            fs.writeFile('log/server_'+date.getDate()+'_'+date.getHours()+'_'+date.getMinutes()+'_'+date.getMilliseconds()+'familyList.txt', JSON.stringify(families,null,2));
            break;
        default:
            break;
    }
}

var workTimer = setInterval(sendNewWork, 3000);

function connectAgents (socket, agentData) {
    if (!checkRegister(agentData.id)) {
        if (agentData.id == null ||
            agentData.performance == null ||
            agentData.kind==null) {
            rejectRegister(socket);
        }
        registerAgent(agentData, socket);
    }
    clientList[agentData.id].state = true;

    if (checkFamily(agentData)) {
        //Family is already exist, and added as new member.
        //update family list of whole family
        var members = families[agentData.owner].member;
        var len = members.length;
        for (var i = 0; i<len; i++) {
            if(clientList[members[i]].state)
                io.sockets.connected[clientList[members[i]].socket].emit(
                'updateFamilyMembers', members
            );
        }
    } else {
        //Family doesn't exist, so family has generated.
        //Send generated family data to target agent
        io.sockets.
           connected[socket.id].emit('familySet',families[agentData.owner]);
    }
    recordData('agent');
    io.sockets.connected[socket.id].emit('connectAccepted');
    io.emit('newAgent',agentData);
}

function checkFamily (agentData) {
    if (families[agentData.owner]) {
        if(families[agentData.owner].member.indexOf(agentData.id) === -1) {
            families[agentData.owner].member.push(agentData.id);
            recordData('family');
            return true;
        }
    } else {
        families[agentData.owner] = {
            name : agentData.owner,
            member : [agentData.id]
        };
        recordData('family');
    }
    return false;
}

function rejectRegister (socket) {
    io.sockets.connected[socket.id].emit('disconnect',
        'connection refused<wrong agent data>');
}

function checkRegister (id) {
    if (clientList[id]) return true;
    else return false;
}

function registerAgent (agentData, socket) {
    clientList[agentData.id] = agentData;
    clientList[agentData.id].socket = socket.id;
    clientList[agentData.id].register = false;
}

function disconnectAgent(id) {
    var agent = findAgentBySocketId(id);
    if (agent) {
        agent.socket = null;
        agent.state = false;
    }
}

function findAgentBySocketId(id) {
    for (var i in clientList) {
        if (clientList[i].socket === id)
            return clientList[i];
    }
    return false;
}

function sendAgentList (socket) {
    var list = [];
    for (var i in clientList) {
        if (clientList[i].state)
            list.push(clientList[i]);
    }
    io.sockets.connected[socket.id].emit('replyAgentList',list);
}

function alertNewNeighbor (data) {
    var reciever = clientList[data.id].socket;
    io.sockets.connected[reciever].emit('newNeighbor',clientList[data.who]);
}

function FamilyWork () {
    this.type = 'Family';
    this.id = 'fwork'+Math.random().toString(36).substr(2, 20);
    var family = families[Object.keys(families)[Math.floor(Math.random()*Object.keys(families).length)]];
    this.needs = generateDuty(getAvailableDomain(family));
    this.family = family;

    function getAvailableDomain (family) {
        var domains = [];
        for (var i in family.member)
        {
            var d = clientList[family.member[i]].domain;
            if (domains.indexOf(d) == -1)
                domains.push(d);

        }
        return domains;
    }

    function generateDuty (domains) {
        var done = false;
        var duty;
        console.log('gen loop in');
        while (!done) {
            duty = gen();
            done = checkDuty(duty);
        }
        return duty;
        
        function gen() {
            var duty = {};
            for (var i in domains)
                duty[domains[i]] = Math.floor(Math.random()*10);    
            return duty;
        }

        function checkDuty (duty) {
            var cnt = 0;
            for (var i in duty) {
                if (duty[i] == 0)
                    cnt ++;
            }
            if (cnt == Object.keys(duty).length)
                return false;
            
            return true;
        }
    }
}

function PublicWork () {
    this.type = 'Public';
    this.id = 'pwork'+Math.random().toString(36).substr(2, 20);
    this.needs = generateNeeds();
    
    function generateNeeds() {
        var n = gen();
        var cnt = 0;
        var done = false;

        while (!done) {
            for (var i in n) {
                if(n[i] == 0) cnt++;
            }

            if (cnt == 6) {
                n = gen();
                cnt = 0;
            } else {
                done = true;
            }
        }

        return n;

        function gen() {
            return {
                'Healthcare' : Math.floor(Math.random()*10),
                'Personal and Social' : Math.floor(Math.random()*10),
                'Transportation and logistics' : Math.floor(Math.random()*10),
                'Smart environment' :  Math.floor(Math.random()*10),
                'Contents processing': Math.floor(Math.random()*3),
                'Contents management' : Math.floor(Math.random()*3)
            }
        }
    }
}

function sendNewWork () {
    if(Object.keys(clientList).length < 10) return;
    var workType = Math.floor(Math.random()*2);
    var work;
    var targetSocket;
    console.log('work type - '+workType+' got into work loop');

    if (workType == 0) {
        work = new PublicWork();
        var done = false;
        var target;
        while(!done) {
            target = chooseAgent(clientList);
            //console.log(target.id + ' : ' + target.state);
            if (target.state && target.register) done = true;
        }
        targetSocket = target.socket;

    } else {
        work = new FamilyWork();
        var done = false;
        var targetAgent;
        while (!done) {
            var targetFamily = chooseAgent(families).member;
            targetAgent = targetFamily[targetFamily.length*Math.random() << 0];
            console.log(targetAgent + ' : ' + clientList[targetAgent].state);
            if (clientList[targetAgent].state && clientList[targetAgent].register) done = true;
        }
        targetSocket = clientList[targetAgent].socket;
    }
    
    console.log('new '+work.type+' work has generated');
    io.sockets.connected[targetSocket].emit('newWork',work);
    
    function chooseAgent(object) {
        var keys = Object.keys(object);
        return object[keys[keys.length*Math.random() << 0]];
    }
}

function registerNewGroup (group) {
    groups[group.id] = group;
    recordData('group');
    io.sockets.connected[pageSocket.id].emit('makeGroup',group);
}

function updateGroupData (group) {
    groups[group.id] = group;
    var members = groups[group.id].entry;
    for (var i in members) {
        io.sockets.connected[clientList[members[i]].socket].emit(
            'updateGroup',group);
    }
    recordData('group');
}

function newGroupMember (groupId, noob) {
    var m = groups[groupId].entry;
    for (var i in m) {
        if(m[i].key != noob) {
            io.sockets.connected[clientList[m[i]].socket].emit('newGroupMember', noob);
        }
    }
    io.sockets.connected[pageSocket.id].emit('newMember',{
        gId : groupId, e : noob
    });
}

function sendGroupInvitation (groupId, from, group) {
    /** 1.send invitation message to clients
     *  2.
     */
    var p = groups[groupId].pending;
    groups[groupId] = group;
    
    for (var d in p) {
        for (var i in p[d]) {
            io.sockets.connected[clientList[p[d][i].key].socket].emit(
                'requestGroupInvitation',{
                    groupId : groupId, from : from, group : group});
        }
    }
}

function rejectGroupInvitation (data) {
    /** data.group, data.from(guest), data.to(team maker) */
    io.sockets.connected[clientList[data.to].socket].emit('rejectGroupInvitation',data);
}

function acceptGroupInvitation (data) {
    io.sockets.connected[clientList[data.to].socket].emit('acceptGroupInvitation',data);
    console.log(data.from+' accept from '+data.to);
}

function completeGroupWork (groupId, agentId) {
    for (var m in groups[groupId].entry) {
        if (groups[groupId].entry[m] !== agentId) {
            io.sockets.connected[clientList[groups[groupId].entry[m]].socket].emit('completeGroupWork', groupId);
        }
    }
    io.sockets.connected[pageSocket.id].emit('deleteGroup',groupId);
    delete groups[groupId];
    console.log('work complete!');
}

var pageSocket;

io.on('connection', function(agent){
    var agentId = agent.id;

    //Send register request to connected agent
    io.sockets.connected[agent.id].emit('registerToNetwork');

    agent.emit('dv');
    agent.emit('welcome',clientList);
    agent.on('dvjoin',() => {
        pageSocket = agent;
    });

    agent.on('replyToRegister',(data) => {
        connectAgents(agent, data);
    });
    
    agent.on('requestAgentList', () => {
        sendAgentList(agent);
    });
    
    agent.on('alertJoinToNeighbor', (data) => {
        alertNewNeighbor(data);
    });

    agent.on('registerComplete', id => {
        clientList[id].register = true;
    });
    
    agent.on('disconnect', () => {
        disconnectAgent(agentId);
        console.log('agent'+agentId+' disconnected');
        //console.log(clientList);
        recordData('clientList');
    });

    agent.on('registerNewGroup', group => {
        registerNewGroup(group);
    });

    agent.on('updateGroupData', group => {
        updateGroupData(group);
    });

    agent.on('newGroupMember', (data)=>{
        newGroupMember(data.groupId, data.from);
    });

    agent.on('sendGroupInvitation', (data) => {
        sendGroupInvitation(data.groupId, data.from, data.group);
    });

    agent.on('rejectGroupInvitation', data => {
        rejectGroupInvitation(data);
    });

    agent.on('acceptGroupInvitation', data => {
        acceptGroupInvitation(data);
    });

    agent.on('completeGroupWork', groupid => {
        completeGroupWork(groupid, agent.id);
    });
});
server.listen(3000);