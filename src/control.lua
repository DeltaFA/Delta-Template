
script.on_init(function()
    global.inserter_guis = {}
end)

local function create_gui(player)
    local gui = player.gui.relative.add{
        type = "frame",
        caption = { "dt-gui.inster-config" },
        anchor = {
            gui = defines.relative_gui_type.inserter_gui,
            position = defines.relative_gui_position.right
        }
    }
    gui.add{
        type = "frame",
        name = "inserter_switches",
        style = "inside_shallow_frame_with_padding",
        direction = "vertical"
    }
    gui.inserter_switches.add{
        type = "switch",
        name = "inserter_direction",
        tooltip = { "dt-gui.inserter_direction" },
        allow_none_state = true,
        switch_state = "none",
        left_label_caption = { "dt-gui.left" },
        right_label_caption = { "dt-gui.right" },
        actions = {
            on_switch_state_changed = { gui = "inserter", action = "change_inserter_setting" },
        }
    }
    gui.inserter_switches.add{
        type = "switch",
        name = "inserter_lenght",
        tooltip = { "dt-gui.inserter_lenght" },
        --allow_none_state = true,
        switch_state = "left",
        left_label_caption = { "dt-gui.short" },
        right_label_caption = { "dt-gui.long" },
        actions = {
            on_switch_state_changed = { gui = "inserter", action = "change_inserter_setting" },
        }
    }
    gui.inserter_switches.add{
        type = "switch",
        name = "inserter_lane",
        tooltip = { "dt-gui.inserter_lane" },
        --allow_none_state = true,
        switch_state = "left",
        left_label_caption = { "dt-gui.far" },
        right_label_caption = { "dt-gui.close" },
        actions = {
            on_switch_state_changed = { gui = "inserter", action = "change_inserter_setting" },
        }
    }

    global.inserter_guis[player.index] = gui
end

script.on_event(defines.events.on_player_created, function(event)
    local player = game.get_player(event.player_index)
    if player then
        create_gui(player)
    end
end)

local function add_vectors(a, b)
    local nx = a.x + b.x
    local ny = a.y + b.y
    return { x = nx, y = ny}
end

local function subtract_vectors(a, b)
    local nx = a.x - b.x
    local ny = a.y - b.y
    return { x = nx, y = ny}
end

local function vector_distance(a, b)
    local x2 = math.pow((a.x - b.x), 2)
    local y2 = math.pow((a.y - b.y), 2)
    return math.sqrt(x2 + y2)
end

local function vector_direction(vector)
    local x = vector.x
    local y = vector.y

    if y < 0 then
        return defines.direction.north
    elseif y > 0 then
        return defines.direction.south
    elseif x > 0 then
        return defines.direction.east
    elseif x < 0 then
        return defines.direction.west
    end
end

local function rotate_vector(vector, direction)
    local ox = vector.x
    local oy = vector.y
    local nx = 0
    local ny = 0

    if direction == defines.direction.north then
        nx = ox * -1
        ny = oy * 1
    elseif direction == defines.direction.south then
        nx = ox * 1
        ny = oy * -1
    elseif direction == defines.direction.east or direction == "left" then
        nx = oy * -1
        ny = ox * -1
    elseif direction == defines.direction.west or direction == "right" then
        nx = oy * 1
        ny = ox * 1
    end
    return { x = nx, y = ny}
end

local function change_inserter_settings(inserter, values)
    local pickup = { x = 0, y = -1 }
    if values.lenght == "right" then
        pickup = add_vectors(pickup, { x = 0, y = -1 })
    end
    inserter.pickup_position = add_vectors(inserter.position, rotate_vector(pickup, inserter.direction))
    
    local dropoff = { x = 0, y = 1.20 }
    if values.lenght == "right" then
        dropoff = add_vectors(dropoff, { x = 0, y = 1 })
    end
    if values.lane == "right" then
        dropoff = add_vectors(dropoff, { x = 0, y = -0.30 })
    end

    if values.direction ~= "none" then
        dropoff = rotate_vector(dropoff, values.direction)
    end

    inserter.drop_position = add_vectors(inserter.position, rotate_vector(dropoff, inserter.direction))
end

local function get_inserter_state(inserter)
    local current = {}

    local drop_vector = subtract_vectors(inserter.position, inserter.drop_position)
    local drop_vector_direction = vector_direction(drop_vector)

    if drop_vector_direction == inserter.direction then
        current.direction = "none"
    elseif (drop_vector_direction - inserter.direction == 2) or (drop_vector_direction - inserter.direction == -6) then
        current.direction = "right"
    else
        current.direction = "left"
    end

    local lenght = vector_distance(inserter.position, inserter.drop_position)
    if lenght > 1.8 then
        current.lenght = "right"
        lenght = lenght - 2
    else
        current.lenght = "left"
        lenght = lenght - 1
    end 

    if lenght > 0 then
        current.lane = "left"
    else
        current.lane = "right"
    end 

    return current
end

local function update_gui(player, inserter)
    local gui = global.inserter_guis[player.index]
    if gui and gui.valid then
        local current = get_inserter_state(inserter)
        gui.inserter_switches.inserter_direction.switch_state = current.direction
        gui.inserter_switches.inserter_lenght.switch_state = current.lenght
        gui.inserter_switches.inserter_lane.switch_state = current.lane
    end
end

script.on_event(defines.events.on_gui_switch_state_changed, function(event)
    if event.element.parent.name == "inserter_switches" then
        local player = game.get_player(event.player_index)
        if player.opened_gui_type == defines.gui_type.entity then
        local entity = player.opened
            if entity and entity.valid and entity.type == "inserter" then
                local gui = global.inserter_guis[player.index]
                if gui and gui.valid then
                    local values = {}
                    values.direction = gui.inserter_switches.inserter_direction.switch_state
                    values.lenght = gui.inserter_switches.inserter_lenght.switch_state
                    values.lane = gui.inserter_switches.inserter_lane.switch_state

                    change_inserter_settings(entity, values)

                    for player_index in pairs(global.inserter_guis) do
                        local player = game.get_player(player_index)
                        if player.opened_gui_type == defines.gui_type.entity then
                            local opened = player.opened
                            if opened and opened == entity then
                                update_gui(player, entity)
                            end
                        end
                    end
                end
            end
        end
    end
end)

script.on_event(defines.events.on_gui_opened, function(event)
    local player = game.get_player(event.player_index)
    if event.entity then 
        local entity = event.entity
        if player and entity.valid and entity.type == "inserter" then
            update_gui(player, entity)
        end
    end
end)